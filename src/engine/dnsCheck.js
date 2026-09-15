const dns = require('dns');

/**
 * Perform DNS resolution for a given hostname.
 * @param {string} hostname
 * @param {number} timeoutMs
 * @returns {Promise<{success: boolean, address?: string, root_cause?: string, detail_message?: string}>}
 */
async function checkDns(hostname, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve({ success: false, root_cause: 'TIMEOUT', detail_message: 'DNS lookup timed out' });
    }, timeoutMs);

    dns.lookup(hostname, (err, address) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (err) {
        resolve({ success: false, root_cause: 'DNS_FAILED', detail_message: err.message });
      } else {
        resolve({ success: true, address });
      }
    });
  });
}

module.exports = checkDns;
