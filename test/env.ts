// Must be imported before any app module: config reads env at import time.
process.env.TRUST_PROXY = '1';
process.env.ARGON_MEMORY_KIB = '8192'; // fast tests; production uses >= 65536
