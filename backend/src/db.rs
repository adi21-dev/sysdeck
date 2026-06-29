use rusqlite::{params, Connection, Result};
use serde::Serialize;

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
            snap.battery_charging.map(|v| v as i32),
        ],
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
            battery_charging: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}
