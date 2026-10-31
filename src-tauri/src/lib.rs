//! NovelDesk Rust 核心：SQLite 存储 + 快照逻辑
//!
//! 防丢稿设计（Rust 侧兜底）：
//! 1. `update_chapter` 每次调用都写 SQLite（前端已做 800ms 防抖）
//! 2. 若距上次快照超过 SNAPSHOT_MIN_INTERVAL 分钟、或内容字数变化超过
//!    SNAPSHOT_WORD_DIFF，自动把"旧内容"存入 snapshots 表
//! 3. 每章最多保留 MAX_SNAPSHOTS_PER_CHAPTER 份快照，超出滚动删除最旧的
//! 4. 即使前端 flush 被系统中断，最多丢 800ms 防抖窗口内的内容

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;

const SNAPSHOT_MIN_INTERVAL_MINUTES: i64 = 5;
const SNAPSHOT_WORD_DIFF: i64 = 200;
const MAX_SNAPSHOTS_PER_CHAPTER: usize = 50;

struct Db(Mutex<Connection>);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChapterMeta {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub word_count: i64,
    pub status: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chapter {
    #[serde(flatten)]
    pub meta: ChapterMeta,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Snapshot {
    pub id: i64,
    pub chapter_id: i64,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct DailyStat {
    pub day: String,
    pub total: i64,
}

/// 中文字数：CJK 每字计 1，连续英数串计 1（与前端口径一致）
fn count_words(text: &str) -> i64 {
    let mut cjk: i64 = 0;
    for c in text.chars() {
        if ('\u{4e00}'..='\u{9fff}').contains(&c)
            || ('\u{3400}'..='\u{4dbf}').contains(&c)
        {
            cjk += 1;
        }
    }
    // 粗略英文词计数
    let latin = text
        .split(|c: char| !(c.is_ascii_alphanumeric()))
        .filter(|s| !s.is_empty())
        .count() as i64;
    cjk + latin
}

fn init_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let conn = Connection::open(dir.join("novel.db"))
        .map_err(|e| format!("打开数据库失败: {e}"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        INSERT OR IGNORE INTO books (id, title) VALUES (1, '我的第一本书');

        CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL REFERENCES books(id),
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            word_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL REFERENCES chapters(id),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_chapter
            ON snapshots(chapter_id, id DESC);

        CREATE TABLE IF NOT EXISTS word_count_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL REFERENCES chapters(id),
            delta INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL REFERENCES books(id),
            name TEXT NOT NULL,
            profile TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT ''
        );",
    )
    .map_err(|e| format!("初始化表结构失败: {e}"))?;

    Ok(conn)
}

/* ------------------------------------------------------------------ */
/* Tauri Commands                                                      */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn list_chapters(state: tauri::State<Db>, book_id: i64) -> Result<Vec<ChapterMeta>, String> {
    let conn = state.0.lock().map_err(|_| "数据库锁失败")?;
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, title, word_count, status, sort_order
             FROM chapters WHERE book_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| {
            Ok(ChapterMeta {
                id: r.get(0)?,
                book_id: r.get(1)?,
                title: r.get(2)?,
                word_count: r.get(3)?,
                status: r.get(4)?,
                sort_order: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_chapter(state: tauri::State<Db>, chapter_id: i64) -> Result<Chapter, String> {
    let conn = state.0.lock().map_err(|_| "数据库锁失败")?;
    conn.query_row(
        "SELECT id, book_id, title, word_count, status, sort_order, content
         FROM chapters WHERE id = ?1",
        params![chapter_id],
        |r| {
            Ok(Chapter {
                meta: ChapterMeta {
                    id: r.get(0)?,
                    book_id: r.get(1)?,
                    title: r.get(2)?,
                    word_count: r.get(3)?,
                    status: r.get(4)?,
                    sort_order: r.get(5)?,
                },
                content: r.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "章节不存在".to_string())
}

#[tauri::command]
fn create_chapter(state: tauri::State<Db>, title: String) -> Result<Chapter, String> {
    let conn = state.0.lock().map_err(|_| "数据库锁失败")?;
    let order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM chapters WHERE book_id = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chapters (book_id, title, sort_order) VALUES (1, ?1, ?2)",
        params![title, order],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(Chapter {
        meta: ChapterMeta {
            id,
            book_id: 1,
            title,
            word_count: 0,
            status: "draft".into(),
            sort_order: order,
        },
        content: String::new(),
    })
}

#[tauri::command]
fn update_chapter(
    state: tauri::State<Db>,
    chapter_id: i64,
    title: String,
    content: String,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|_| "数据库锁失败")?;

    let old: Option<(String, i64)> = conn
        .query_row(
            "SELECT content, word_count FROM chapters WHERE id = ?1",
            params![chapter_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (old_content, old_wc) = old.ok_or_else(|| "章节不存在".to_string())?;

    let new_wc = count_words(&content);
    conn.execute(
        "UPDATE chapters SET title = ?1, content = ?2, word_count = ?3 WHERE id = ?4",
        params![title, content, new_wc, chapter_id],
    )
    .map_err(|e| e.to_string())?;

    // 码字流水（供日/周统计）
    let delta = new_wc - old_wc;
    if delta != 0 {
        conn.execute(
            "INSERT INTO word_count_log (chapter_id, delta, created_at) VALUES (?1, ?2, ?3)",
            params![chapter_id, delta, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
    }

    // ---- 快照判定 ----
    let mut snapshotted = false;
    if old_content != content {
        let last: Option<(String, String)> = conn
            .query_row(
                "SELECT content, created_at FROM snapshots WHERE chapter_id = ?1 ORDER BY id DESC LIMIT 1",
                params![chapter_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let need = match &last {
            None => true,
            Some((snap_content, snap_at)) => {
                let diff = (content.chars().count() as i64) - (snap_content.chars().count() as i64);
                let elapsed_min = match chrono::DateTime::parse_from_rfc3339(snap_at) {
                    Ok(t) => (Utc::now() - t.with_timezone(&chrono::Utc)).num_minutes(),
                    Err(_) => i64::MAX, // 时间戳解析失败时宁可多存一份
                };
                diff.abs() >= SNAPSHOT_WORD_DIFF
                    || elapsed_min >= SNAPSHOT_MIN_INTERVAL_MINUTES
            }
        };

        if need {
            conn.execute(
                "INSERT INTO snapshots (chapter_id, content, created_at) VALUES (?1, ?2, ?3)",
                params![chapter_id, old_content, Utc::now().to_rfc3339()],
            )
            .map_err(|e| e.to_string())?;
            // 滚动清理：每章最多留 N 份
            conn.execute(
                "DELETE FROM snapshots WHERE chapter_id = ?1 AND id NOT IN (
                    SELECT id FROM snapshots WHERE chapter_id = ?1 ORDER BY id DESC LIMIT ?2)",
                params![chapter_id, MAX_SNAPSHOTS_PER_CHAPTER as i64],
            )
            .map_err(|e| e.to_string())?;
            snapshotted = true;
        }
    }

    Ok(serde_json::json!({ "ok": true, "snapshotted": snapshotted }))
}

#[tauri::command]
fn list_snapshots(
    state: tauri::State<Db>,
    chapter_id: i64,
) -> Result<Vec<Snapshot>, String> {
    let conn = state.0.lock().map_err(|_| "数据库锁失败")?;
    let mut stmt = conn
        .prepare(
            "SELECT id, chapter_id, content, created_at FROM snapshots
             WHERE chapter_id = ?1 ORDER BY id DESC LIMIT 20",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chapter_id], |r| {
            Ok(Snapshot {
                id: r.get(0)?,
                chapter_id: r.get(1)?,
                content: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_stats(state: tauri::State<Db>, days: i64) -> Result<Vec<DailyStat>, String> {
    let conn = state.0.lock().map_err(|_| "数据库锁失败")?;
    let mut stmt = conn
        .prepare(
            "SELECT date(created_at), SUM(delta) FROM word_count_log
             WHERE created_at >= datetime('now', '-' || ?1 || ' days', 'localtime')
             GROUP BY date(created_at) ORDER BY date(created_at)",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![days], |r| {
            Ok(DailyStat {
                day: r.get(0)?,
                total: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let conn = init_db(app.handle()).map_err(std::io::Error::other)?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_chapters,
            get_chapter,
            create_chapter,
            update_chapter,
            list_snapshots,
            get_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
