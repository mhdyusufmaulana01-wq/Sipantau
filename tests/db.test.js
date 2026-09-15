const { DbClient } = require('../src/db/client');
const path = require('path');
const fs = require('fs');

describe('Database Client', () => {
  let dbClient;
  const testDbPath = path.join(__dirname, 'test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    dbClient = new DbClient(testDbPath);
  });

  afterAll(() => {
    dbClient.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('should create a monitor and retrieve it', () => {
    const monitorId = dbClient.addMonitor({
      name: 'Google Test',
      url: 'https://google.com',
      interval_seconds: 60
    });

    expect(monitorId).toBeGreaterThan(0);

    const monitor = dbClient.getMonitorById(monitorId);
    expect(monitor.name).toBe('Google Test');
    expect(monitor.status).toBe('UNKNOWN');
    expect(monitor.is_active).toBe(1);
  });

  it('should find due monitors when last_checked_at is null', () => {
    const dueMonitors = dbClient.getMonitorsDueForCheck();
    expect(dueMonitors.length).toBe(1);
    expect(dueMonitors[0].name).toBe('Google Test');
  });

  it('should update status and insert check result', () => {
    const monitorId = 1;
    
    dbClient.updateMonitorStatus(monitorId, 'UP');
    dbClient.addCheckResult({
      monitor_id: monitorId,
      status: 'UP',
      root_cause: 'NONE',
      detail_message: null,
      dns_ok: true,
      tcp_ok: true,
      http_status_code: 200,
      response_time_ms: 120,
      ssl_valid: true,
      ssl_expiry_date: new Date().toISOString()
    });

    const monitor = dbClient.getMonitorById(monitorId);
    expect(monitor.status).toBe('UP');
    expect(monitor.last_checked_at).not.toBeNull();

    // After updating, it shouldn't be due immediately (interval is 60s)
    const dueMonitorsNow = dbClient.getMonitorsDueForCheck();
    expect(dueMonitorsNow.length).toBe(0);
  });
});
