// npm run setup            -> creates the single account (refuses if one exists)
// npm run reset-credentials -> --reset: new password, TOTP, recovery codes; all sessions dropped
import { createInterface } from 'node:readline/promises';
import qr from 'qrcode-terminal';
import { getDb } from '../src/server/db.ts';
import { provision } from '../src/server/provision.ts';

const reset = process.argv.includes('--reset');
const argUser = process.argv.find((a) => a.startsWith('--username='))?.slice(11);

async function main() {
  const db = getDb();
  const exists = db.prepare('SELECT username FROM users WHERE id=1').get() as { username: string } | undefined;
  if (exists && !reset) {
    console.error('Kullanıcı zaten var. Kimlik bilgilerini yenilemek için: npm run reset-credentials');
    process.exit(1);
  }
  let username = argUser ?? exists?.username ?? '';
  if (!username) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    username = (await rl.question('Kullanıcı adı: ')).trim();
    rl.close();
  }
  const p = await provision(username, reset);
  const line = '─'.repeat(64);
  console.log(`\n${line}\nBU ÇIKTI BİR KEZ GÖSTERİLİR. Doğrudan parola yöneticisine kopyala.\nHiçbir yere kaydedilmedi; sohbete veya repoya yapıştırma.\n${line}`);
  console.log(`kullanıcı adı : ${p.username}`);
  console.log(`parola        : ${p.password}`);
  console.log(`TOTP secret   : ${p.totpSecret}`);
  console.log(`otpauth URI   : ${p.otpauth}`);
  console.log('\nTOTP QR (doğrulayıcı uygulamayla tara):');
  qr.generate(p.otpauth, { small: true });
  console.log('\nKurtarma kodları (her biri tek kullanımlık):');
  p.recoveryCodes.forEach((c) => console.log('  ' + c));
  console.log(`${line}\nargon2id: m=${p.argon.m / 1024} MiB, t=${p.argon.t}, p=1 (~${p.argon.ms} ms)`);
  console.log(reset ? 'Tüm oturumlar kapatıldı.' : 'Hesap oluşturuldu.');
}
main().catch((e) => { console.error(String((e as Error).message ?? 'hata')); process.exit(1); });
