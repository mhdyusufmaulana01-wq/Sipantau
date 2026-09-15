const net = require('net');

/**
 * Perform TCP connection check.
 * @param {string} hostname
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{success: boolean, root_cause?: string, detail_message?: string}>}
 */
async function checkTcp(hostname, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.on('connect', () => {
      finish({ success: true });
    });

    socket.on('timeout', () => {
      finish({ success: false, root_cause: 'TCP_TIMEOUT', detail_message: `TCP connection timed out to port ${port}` });
    });

    socket.on('error', (err) => {
      // [BUG FIX] Diferensiasi error berdasarkan kode — bukan semuanya CONNECTION_REFUSED
      let rootCause;
      if (err.code === 'ECONNREFUSED') {
        rootCause = 'TCP_CONNECTION_REFUSED';
      } else if (['ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN'].includes(err.code)) {
        rootCause = 'TCP_TIMEOUT';
      } else {
        rootCause = 'TCP_CONNECTION_REFUSED'; // fallback
      }
      finish({ success: false, root_cause: rootCause, detail_message: `${err.code}: ${err.message}` });
    });

    socket.connect(port, hostname);
  });
}

module.exports = checkTcp;
