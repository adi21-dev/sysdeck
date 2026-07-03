use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct TelemetrySnapshot {
    pub timestamp: i64,
    pub cpu_usage: f32,
    pub ram_used: u64,
    pub ram_total: u64,
    pub net_rx_bps: u64,
    pub net_tx_bps: u64,
    pub temperature: Option<f32>,
    pub disk_used: u64,
    pub disk_total: u64,
    pub battery_percent: Option<f32>,
    pub battery_charging: Option<bool>,
}

pub fn init_telemetry_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            cpu_usage REAL NOT NULL,
            ram_used INTEGER NOT NULL,
            ram_total INTEGER NOT NULL,
            net_rx_bps INTEGER NOT NULL,
            net_tx_bps INTEGER NOT NULL,
            temperature REAL,
            disk_used INTEGER NOT NULL,
            disk_total INTEGER NOT NULL,
            battery_percent REAL,
            battery_charging INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(timestamp);",
    )
}

pub fn insert_telemetry(conn: &Connection, snap: &TelemetrySnapshot) -> Result<()> {
    conn.execute(
        "INSERT INTO telemetry (timestamp, cpu_usage, ram_used, ram_total, net_rx_bps, net_tx_bps, temperature, disk_used, disk_total, battery_percent, battery_charging)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            snap.timestamp,
            snap.cpu_usage,
            snap.ram_used as i64,
            snap.ram_total as i64,
            snap.net_rx_bps as i64,
            snap.net_tx_bps as i64,
            snap.temperature,
            snap.disk_used as i64,
            snap.disk_total as i64,
            snap.battery_percent,
            snap.battery_charging.map(|b| b as i64),
        ],
    )?;
    Ok(())
}

pub fn init_auth_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            password_hash TEXT NOT NULL,
            totp_secret TEXT NOT NULL,
            token_version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recovery_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_hash TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_jti TEXT NOT NULL UNIQUE,
            refresh_token_hash TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jwt_signing_key (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            encrypted_key BLOB NOT NULL
        );",
    )
}

pub fn is_setup_complete(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
    Ok(count > 0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: i64,
    pub event: String,
    pub details: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: i64,
}

pub fn insert_audit_log(
    conn: &Connection,
    event: &str,
    details: Option<&str>,
    ip_address: Option<&str>,
) -> Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO audit_logs (event, details, ip_address, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![event, details, ip_address, now],
    )?;
    Ok(())
}

pub fn query_telemetry_history(conn: &Connection, since_ts: i64) -> Result<Vec<TelemetrySnapshot>> {
    let mut stmt = conn.prepare(
        "SELECT timestamp, cpu_usage, ram_used, ram_total, net_rx_bps, net_tx_bps, temperature, disk_used, disk_total, battery_percent, battery_charging
         FROM telemetry
         WHERE timestamp >= ?1
         ORDER BY timestamp ASC
         LIMIT 10000",
    )?;

    let rows = stmt.query_map(params![since_ts], |row| {
        Ok(TelemetrySnapshot {
            timestamp: row.get(0)?,
            cpu_usage: row.get(1)?,
            ram_used: row.get::<_, i64>(2)? as u64,
            ram_total: row.get::<_, i64>(3)? as u64,
            net_rx_bps: row.get::<_, i64>(4)? as u64,
            net_tx_bps: row.get::<_, i64>(5)? as u64,
            temperature: row.get(6)?,
            disk_used: row.get::<_, i64>(7)? as u64,
            disk_total: row.get::<_, i64>(8)? as u64,
            battery_percent: row.get(9)?,
            battery_charging: row.get::<_, Option<i64>>(10)?.map(|v| v != 0),
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub fn migrate_telemetry_schema_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "ALTER TABLE telemetry ADD COLUMN battery_percent REAL;
         ALTER TABLE telemetry ADD COLUMN battery_charging INTEGER;",
    )
    .ok();
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn wal_checkpoint(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

pub fn query_audit_logs(
    conn: &Connection,
    cursor: Option<i64>,
    limit: i64,
    event: Option<&str>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<AuditLogEntry>> {
    let mut sql =
        String::from("SELECT id, event, details, ip_address, created_at FROM audit_logs WHERE 1=1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(c) = cursor {
        sql.push_str(" AND id < ?");
        param_values.push(Box::new(c));
    }
    if let Some(e) = event {
        sql.push_str(" AND event = ?");
        param_values.push(Box::new(e.to_string()));
    }
    if let Some(f) = from {
        sql.push_str(" AND created_at >= ?");
        param_values.push(Box::new(f));
    }
    if let Some(t) = to {
        sql.push_str(" AND created_at <= ?");
        param_values.push(Box::new(t));
    }

    sql.push_str(" ORDER BY id DESC LIMIT ?");
    param_values.push(Box::new(limit + 1));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(AuditLogEntry {
            id: row.get(0)?,
            event: row.get(1)?,
            details: row.get(2)?,
            ip_address: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn test_init_telemetry_table_idempotent() {
        let conn = test_conn();
        init_telemetry_table(&conn).unwrap();
        init_telemetry_table(&conn).unwrap();
    }

    #[test]
    fn test_init_auth_tables_idempotent() {
        let conn = test_conn();
        init_auth_tables(&conn).unwrap();
        init_auth_tables(&conn).unwrap();
    }

    #[test]
    fn test_insert_and_query_telemetry() {
        let conn = test_conn();
        init_telemetry_table(&conn).unwrap();
        let snap = TelemetrySnapshot {
            timestamp: 1000,
            cpu_usage: 45.5,
            ram_used: 8000000000,
            ram_total: 16000000000,
            net_rx_bps: 1000000,
            net_tx_bps: 500000,
            temperature: Some(65.0),
            disk_used: 200000000000,
            disk_total: 500000000000,
            battery_percent: None,
            battery_charging: None,
        };
        insert_telemetry(&conn, &snap).unwrap();
        let results = query_telemetry_history(&conn, 0).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].cpu_usage, 45.5);
    }

    #[test]
    fn test_query_telemetry_empty() {
        let conn = test_conn();
        init_telemetry_table(&conn).unwrap();
        let results = query_telemetry_history(&conn, 0).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_query_telemetry_by_timestamp() {
        let conn = test_conn();
        init_telemetry_table(&conn).unwrap();
        let snap = TelemetrySnapshot {
            timestamp: 5000,
            cpu_usage: 10.0,
            ram_used: 0,
            ram_total: 0,
            net_rx_bps: 0,
            net_tx_bps: 0,
            temperature: None,
            disk_used: 0,
            disk_total: 0,
            battery_percent: None,
            battery_charging: None,
        };
        insert_telemetry(&conn, &snap).unwrap();
        let results = query_telemetry_history(&conn, 10000).unwrap();
        assert!(results.is_empty());
        let results = query_telemetry_history(&conn, 0).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_is_setup_complete_empty() {
        let conn = test_conn();
        init_auth_tables(&conn).unwrap();
        assert!(!is_setup_complete(&conn).unwrap());
    }

    #[test]
    fn test_is_setup_complete_with_user() {
        let conn = test_conn();
        init_auth_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash', 'secret', 1000, 1000)",
            [],
        ).unwrap();
        assert!(is_setup_complete(&conn).unwrap());
    }

    #[test]
    fn test_insert_audit_log() {
        let conn = test_conn();
        init_auth_tables(&conn).unwrap();
        insert_audit_log(&conn, "test_event", Some("details"), Some("127.0.0.1")).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit_logs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_duplicate_user_insert() {
        let conn = test_conn();
        init_auth_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash1', 'secret1', 1000, 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash2', 'secret2', 2000, 2000)",
            [],
        ).unwrap();
        assert!(is_setup_complete(&conn).unwrap());
    }

    #[test]
    fn test_audit_log_null_fields() {
        let conn = test_conn();
        init_auth_tables(&conn).unwrap();
        insert_audit_log(&conn, "event", None, None).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit_logs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
