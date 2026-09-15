const tls = require('tls');

/**
 * Perform SSL certificate validation.
 * Returns subject (CN) and issuer (O) in addition to validity info.
 */
async function checkSsl(hostname, port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const options = {
      host: hostname,
      port: port,
      servername: hostname, // Required for SNI
      rejectUnauthorized: false // We check it manually to capture the error details
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        socket.destroy();
        finish({ success: false, root_cause: 'SSL_TIMEOUT', detail_message: 'SSL check timed out' });
      }
    }, timeoutMs);

    const socket = tls.connect(options, () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authorizationError = socket.authorizationError;

      socket.destroy();

      // Extract human-readable subject and issuer
      const sslSubject = cert && cert.subject ? (cert.subject.CN || '') : '';
      const sslIssuer  = cert && cert.issuer  ? (cert.issuer.O  || '') : '';

      // [BUG FIX] Cek EXPIRED lebih dulu, SEBELUM cek 'authorized' keseluruhan chain.
      // Alasannya: sertifikat yang kedaluwarsa otomatis membuat socket.authorized = false
      // (validasi tanggal adalah bagian dari validasi chain di Node/OpenSSL), jadi kalau
      // urutan pengecekan authorized diletakkan duluan, root_cause SSL_CERT_EXPIRED TIDAK
      // PERNAH tercapai untuk kasus expired sungguhan -- selalu jatuh ke SSL_ERROR generik.
      if (cert && cert.valid_to) {
        const validTo = new Date(cert.valid_to);
        const now = new Date();

        if (now > validTo) {
          return finish({
             success: false,
             root_cause: 'SSL_CERT_EXPIRED',
             detail_message: `Sertifikat SSL sudah kedaluwarsa sejak ${validTo.toLocaleDateString('id-ID')}`,
             ssl_valid: false,
             ssl_expiry_date: cert.valid_to,
             ssl_subject: sslSubject,
             ssl_issuer: sslIssuer,
          });
        }
      }

      if (!authorized) {
        return finish({
          success: false,
          root_cause: 'SSL_ERROR',
          detail_message: authorizationError,
          ssl_valid: false,
          ssl_subject: sslSubject,
          ssl_issuer: sslIssuer,
        });
      }

      if (cert && cert.valid_to) {
        return finish({
          success: true,
          ssl_valid: true,
          ssl_expiry_date: cert.valid_to,
          ssl_subject: sslSubject,
          ssl_issuer: sslIssuer,
        });
      }

      finish({
        success: false,
        root_cause: 'SSL_ERROR',
        detail_message: 'No certificate found',
        ssl_valid: false,
        ssl_subject: sslSubject,
        ssl_issuer: sslIssuer,
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish({ success: false, root_cause: 'SSL_ERROR', detail_message: err.message, ssl_valid: false });
    });
  });
}

module.exports = checkSsl;
