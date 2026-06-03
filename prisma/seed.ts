import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with dev credentials...');

  // Hash passwords for dev users
  const customerPassword = await bcrypt.hash('Customer@123', 10);
  const staffPassword = await bcrypt.hash('Staff@123', 10);

  // Clear existing data (optional - comment out to keep data)
  // await prisma.customer.deleteMany({});
  // await prisma.staff.deleteMany({});

  // Create test customers
  const customer1 = await prisma.customer.upsert({
    where: { phone: '254712345678' },
    update: {},
    create: {
      erpId: 'CUST001',
      name: 'John Doe',
      phone: '254712345678',
      password: customerPassword,
      accountStatus: 'ACTIVE',
      outstandingBalance: 0.0,
      region: 'LAGOS',
    },
  });

  await prisma.customer.upsert({
    where: { phone: '254787654321' },
    update: {},
    create: {
      erpId: 'CUST002',
      name: 'Jane Smith',
      phone: '254787654321',
      password: customerPassword,
      accountStatus: 'ACTIVE',
      outstandingBalance: 5000.0,
      region: 'SOUTH_WEST',
    },
  });

  // Create test staff
  await prisma.staff.upsert({
    where: { email: 'admin@viju.local' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@viju.local',
      phone: '+2348000000001',
      password: staffPassword,
      role: 'ADMIN',
      isActive: true,
    },
  });

  const officer = await prisma.staff.upsert({
    where: { email: 'officer@viju.local' },
    update: {},
    create: {
      name: 'Sales Officer',
      email: 'officer@viju.local',
      phone: '+2348000000002',
      password: staffPassword,
      role: 'OFFICER',
      region: 'LAGOS',
      isActive: true,
    },
  });

  // Assign officer to customer
  await prisma.customer.update({
    where: { id: customer1.id },
    data: { assignedOfficerId: officer.id },
  });

  console.log('✅ Database seeded successfully!');
  console.log('\n📋 Dev Credentials:\n');
  console.log('CUSTOMERS:');
  console.log('  Phone: 254712345678 | Name: John Doe');
  console.log('  Phone: 254787654321 | Name: Jane Smith');
  console.log('  Password (both): Customer@123\n');
  console.log('STAFF:');
  console.log('  Email: admin@viju.local | Role: ADMIN');
  console.log('  Email: officer@viju.local | Role: OFFICER');
  console.log('  Password (both): Staff@123\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
