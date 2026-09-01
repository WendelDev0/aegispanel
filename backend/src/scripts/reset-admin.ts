import bcrypt from 'bcryptjs';
import { dbStorage } from '../db/storage.js';

const newPassword = process.argv[2];
const newUsername = process.argv[3] || 'admin';

if (!newPassword || newPassword.length < 12 || newPassword.length > 256) {
  console.error('Uso: npm run reset-admin -- <senha-com-pelo-menos-12-caracteres> [usuario]');
  process.exit(1);
}

async function resetAdmin() {
  const users = dbStorage.getUsers();
  const passwordHash = await bcrypt.hash(newPassword, 12);

  if (users.length > 0) {
    const admin = users[0];
    admin.username = newUsername;
    admin.passwordHash = passwordHash;
    admin.role = 'admin';
    admin.tokenVersion = (admin.tokenVersion ?? 0) + 1;
    dbStorage.saveUser(admin);
    console.log(`\n==================================================`);
    console.log(`🛡️  AegisPanel - Redefinição de Administrador`);
    console.log(`==================================================`);
    console.log(`✅ Usuário: ${newUsername}`);
    console.log(`🔑 Senha: definida com sucesso (não é exibida nos logs)`);
    console.log(`==================================================\n`);
  } else {
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
