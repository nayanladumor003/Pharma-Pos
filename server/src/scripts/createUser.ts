/**
 * Dev/admin bootstrap utility — creates (or updates the password of) a User +
 * its linked Employee. Credentials are supplied at invocation time via env
 * vars only; nothing is hardcoded or committed. Usage:
 *
 *   ADMIN_EMAIL=you@apexpharma.com ADMIN_PASSWORD='...' ADMIN_NAME="You" \
 *   ADMIN_ROLE=Admin ADMIN_PHONE=9800000000 \
 *   ADMIN_PERMISSIONS=view_pos,create_sale,refund_sale,view_inventory,adjust_inventory,manage_medicines,manage_purchases,view_reports,manage_employees,manage_settings \
 *   npx tsx src/scripts/createUser.ts
 */
import { connectDB, disconnectDB } from '../config/db';
import { Employee } from '../models/Employee.model';
import { User } from '../models/User.model';
import { hashPassword } from '../utils/password';
import { EMPLOYEE_ROLES, PERMISSIONS } from '../models/enums';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Admin User';
  const role = (process.env.ADMIN_ROLE ?? 'Admin') as (typeof EMPLOYEE_ROLES)[number];
  const phone = process.env.ADMIN_PHONE ?? '9800000000';
  const permissions = (process.env.ADMIN_PERMISSIONS ?? PERMISSIONS.join(',')).split(',').map((p) => p.trim());

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  await connectDB();

  let employee = await Employee.findOne({ email });
  if (!employee) {
    employee = await Employee.create({ name, email, phone, role, permissions, status: 'Active' });
    console.log(`Created Employee ${employee.id} (${email})`);
  } else {
    console.log(`Using existing Employee ${employee.id} (${email})`);
  }

  const passwordHash = await hashPassword(password);
  const user = await User.findOneAndUpdate(
    { employeeId: employee._id },
    { email, passwordHash, isActive: true, employeeId: employee._id },
    { upsert: true, new: true }
  );

  console.log(`User ready: ${user.id} (${email})`);
  await disconnectDB();
}

main().catch((err) => {
  console.error('Failed to create user:', err);
  process.exit(1);
});
