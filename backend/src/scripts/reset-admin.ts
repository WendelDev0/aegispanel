import bcrypt from 'bcryptjs';
import { dbStorage } from '../db/storage.js';

const args = process.argv.slice(2);
const disable2fa = args.includes('--disable-2fa');
const positional = args.filter((a) => a !== '--disable-2fa');

let newPassword: string | undefined;
let newUsername = 'admin';

if (positional[0] && positional[0].length >= 12) {
  newPassword = positional[0];
  if (positional[1]) newUsername = positional[1];
} else if (disable2fa) {
  if (positional[0]) newUsername = positional[0];
} else {
  console.error('Uso: npm run reset-admin -- <senha-com-pelo-menos-12-caracteres> [usuario] [--disable-2fa]');
  console.error('     npm run reset-admin -- --disable-2fa [usuario]');
  process.exit(1);
}

async function resetAdmin() {
  const users = dbStorage.getUsers();
  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : undefined;

  if (users.length > 0) {
    const admin = users.find((u) => u.username === newUsername) || users[0];
    if (newPassword) admin.username = newUsername;
    if (passwordHash) {
      admin.passwordHash = passwordHash;
      admin.tokenVersion = (admin.tokenVersion ?? 0) + 1;
    }
    admin.role = 'admin';
    if (disable2fa) {
      admin.totpEnabled = false;
      admin.totpSecret = undefined;
      admin.totpRecoveryHashes = [];
    }
    dbStorage.saveUser(admin);
    if (passwordHash) dbStorage.revokeUserSessions(admin.id);
    console.log(`\n==================================================`);
    console.log(`🛡️  AegisPanel - Redefinição de Administrador`);
    console.log(`==================================================`);
    console.log(`✅ Usuário: ${admin.username}`);
    if (passwordHash) console.log(`🔑 Senha: definida com sucesso (não é exibida nos logs)`);
    if (disable2fa) console.log(`🔓 2FA desativado nesta conta.`);
    console.log(`==================================================\n`);
  } else {
    if (!passwordHash) {
      console.error('Não há usuários. Informe uma senha para criar o administrador.');
      process.exit(1);
    }
    const newAdmin = {
      id: `usr_${Date.now().toString(36)}`,
      username: newUsername,
      passwordHash,
      role: 'admin' as const,
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
    };
    dbStorage.saveUser(newAdmin);
    console.log(`\n==================================================`);
    console.log(`🛡️  AegisPanel - Novo Administrador Criado`);
    console.log(`==================================================`);
    console.log(`✅ Usuário: ${newUsername}`);
    console.log(`🔑 Senha: definida com sucesso (não é exibida nos logs)`);
    console.log(`==================================================\n`);
  }
  process.exit(0);
}

resetAdmin().catch((err) => {
  console.error('Erro ao redefinir senha:', err);
  process.exit(1);
});
