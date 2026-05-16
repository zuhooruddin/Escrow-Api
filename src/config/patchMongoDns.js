/**
 * MongoDB Atlas `mongodb+srv://` uses DNS SRV. On some Windows setups the
 * resolver Node uses returns ECONNREFUSED for `querySrv`. Prefer IPv4 first,
 * and optionally force public DNS via MONGODB_DNS_SERVERS in .env (e.g. 8.8.8.8,8.8.4.4).
 */
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

const servers = process.env.MONGODB_DNS_SERVERS;
if (servers && String(servers).trim()) {
  dns.setServers(
    String(servers)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
