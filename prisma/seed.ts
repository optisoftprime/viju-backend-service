import {
  PrismaClient,
  Region,
  StaffRole,
  AccountStatus,
  Staff,
  Customer,
  Purchase,
  LoadingRequestStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CUSTOMER_PASSWORD = 'Customer@123';
const STAFF_PASSWORD = 'Staff@123';

const MAIN_TEST_PHONE = '254712345678';
const SECONDARY_TEST_PHONE = '254787654321';

async function main() {
  console.log('🌱 Seeding database...\n');

  const customerPassword = await bcrypt.hash(CUSTOMER_PASSWORD, 10);
  const staffPassword = await bcrypt.hash(STAFF_PASSWORD, 10);

  // ─── Reset all staff-linked + customer transactional data ─────
  // Lets the seed be idempotent without unique-constraint clashes
  // when re-run after the schema/staff roster changed.
  await prisma.pushToken.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.ticketReply.deleteMany({});
  await prisma.supportTicket.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.loadingRequest.deleteMany({});
  await prisma.purchaseItem.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.broadcast.deleteMany({});
  await prisma.customerOfficer.deleteMany({});
  await prisma.customer.updateMany({ data: { assignedOfficerId: null } });
  await prisma.staff.deleteMany({});

  // ─── Customers (10 total, distributed across regions) ──
  const customerSeeds: Array<{
    erpId: string;
    name: string;
    phone: string;
    region: Region;
    accountStatus: AccountStatus;
    outstandingBalance: number;
  }> = [
    { erpId: 'CUST001', name: 'John Doe',             phone: MAIN_TEST_PHONE,      region: 'LAGOS',      accountStatus: 'ACTIVE',  outstandingBalance: 480000 },
    { erpId: 'CUST002', name: 'Jane Smith',           phone: SECONDARY_TEST_PHONE, region: 'SOUTH_WEST', accountStatus: 'ACTIVE',  outstandingBalance: 5000   },
    { erpId: 'CUST003', name: 'Ade Foods Ltd',        phone: '+2349011000003',     region: 'LAGOS',      accountStatus: 'ACTIVE',  outstandingBalance: 1240000 },
    { erpId: 'CUST004', name: 'K1 Fresh Mart',        phone: '+2349011000004',     region: 'LAGOS',      accountStatus: 'ACTIVE',  outstandingBalance: 0       },
    { erpId: 'CUST005', name: 'Alhaji Bello & Sons',  phone: '+2349011000005',     region: 'NORTH',      accountStatus: 'ACTIVE',  outstandingBalance: 190980  },
    { erpId: 'CUST006', name: 'Ikorodu Mega Distributor', phone: '+2349011000006', region: 'LAGOS',      accountStatus: 'ACTIVE',  outstandingBalance: 320500  },
    { erpId: 'CUST007', name: 'Unity Stores Nig. Ltd',phone: '+2349011000007',     region: 'SOUTH_EAST', accountStatus: 'ON_HOLD', outstandingBalance: 75000   },
    { erpId: 'CUST008', name: 'Alhaji Faruk Shola',   phone: '+2349011000008',     region: 'NORTH',      accountStatus: 'ACTIVE',  outstandingBalance: 0       },
    { erpId: 'CUST009', name: 'Bello & Sons LTD',     phone: '+2349011000009',     region: 'SOUTH_WEST', accountStatus: 'ACTIVE',  outstandingBalance: 60000   },
    { erpId: 'CUST010', name: 'Akpan Stores',         phone: '+2349011000010',     region: 'SOUTH_EAST', accountStatus: 'ACTIVE',  outstandingBalance: 0       },
  ];

  const customers: Customer[] = [];
  for (const c of customerSeeds) {
    const customer = await prisma.customer.upsert({
      where: { phone: c.phone },
      update: {
        erpId: c.erpId,
        name: c.name,
        region: c.region,
        accountStatus: c.accountStatus,
        outstandingBalance: c.outstandingBalance,
      },
      create: {
        erpId: c.erpId,
        name: c.name,
        phone: c.phone,
        password: customerPassword,
        accountStatus: c.accountStatus,
        outstandingBalance: c.outstandingBalance,
        region: c.region,
      },
    });
    customers.push(customer);
  }
  const customer1 = customers[0];

  // ─── Staff (10 across all roles) ───────────────────────
  const staffSeeds: Array<{
    email: string;
    name: string;
    phone: string;
    role: StaffRole;
    region: Region | null;
  }> = [
    { email: 'admin@viju.local',     name: 'Admin User',          phone: '+2348000000001', role: 'ADMIN',             region: null      },
    { email: 'officer.north@viju.local',    name: 'Aisha Bello',    phone: '+2348000000002', role: 'OFFICER',           region: 'NORTH'     },
    { email: 'officer.lagos@viju.local',    name: 'Funmi Adelaja',  phone: '+2348000000003', role: 'OFFICER',           region: 'LAGOS'     },
    { email: 'officer.sw@viju.local',       name: 'David Ukonmagu', phone: '+2348000000004', role: 'OFFICER',           region: 'SOUTH_WEST' },
    { email: 'officer.se@viju.local',       name: 'Emeka Nwakolo',  phone: '+2348000000005', role: 'OFFICER',           region: 'SOUTH_EAST' },
    { email: 'regional.lagos@viju.local',   name: 'Ngozi Okafor',   phone: '+2348000000006', role: 'REGIONAL_ADMIN',    region: 'LAGOS'     },
    { email: 'regional.north@viju.local',   name: 'Musa Aliyu',     phone: '+2348000000007', role: 'REGIONAL_ADMIN',    region: 'NORTH'     },
    { email: 'loader.lagos@viju.local',     name: 'Ifeanyi Okonkwo',phone: '+2348000000008', role: 'LOADING_OFFICER',   region: 'LAGOS'     },
    { email: 'loader.sw@viju.local',        name: 'Bisi Adewale',   phone: '+2348000000009', role: 'LOADING_OFFICER',   region: 'SOUTH_WEST' },
    { email: 'warehouse.lagos@viju.local',  name: 'Ibrahim Musa',   phone: '+2348000000010', role: 'WAREHOUSE_OFFICER', region: 'LAGOS'     },
  ];

  const staffList: Staff[] = [];
  for (const s of staffSeeds) {
    const staff = await prisma.staff.upsert({
      where: { email: s.email },
      update: { phone: s.phone, region: s.region, role: s.role },
      create: {
        name: s.name,
        email: s.email,
        phone: s.phone,
        password: staffPassword,
        role: s.role,
        region: s.region,
        isActive: true,
      },
    });
    staffList.push(staff);
  }

  const lagosOfficer = staffList.find((s) => s.email === 'officer.lagos@viju.local')!;
  const secondLagosOfficer = staffList.find((s) => s.email === 'officer.sw@viju.local')!;
  const lagosLoader = staffList.find((s) => s.email === 'loader.lagos@viju.local')!;
  const adminUser = staffList.find((s) => s.email === 'admin@viju.local')!;

  // Assign Lagos officer as primary for customer1
  await prisma.customer.update({
    where: { id: customer1.id },
    data: { assignedOfficerId: lagosOfficer.id },
  });

  // Two-officer assignment for customer1 (PRD F6)
  await prisma.customerOfficer.upsert({
    where: { customerId_staffId: { customerId: customer1.id, staffId: lagosOfficer.id } },
    update: { isPrimary: true },
    create: { customerId: customer1.id, staffId: lagosOfficer.id, isPrimary: true },
  });
  await prisma.customerOfficer.upsert({
    where: { customerId_staffId: { customerId: customer1.id, staffId: secondLagosOfficer.id } },
    update: { isPrimary: false },
    create: { customerId: customer1.id, staffId: secondLagosOfficer.id, isPrimary: false },
  });

  // Assign each other customer to an officer in their region
  const officersByRegion: Record<string, Staff | undefined> = {
    LAGOS:      lagosOfficer,
    SOUTH_WEST: staffList.find((s) => s.email === 'officer.sw@viju.local'),
    SOUTH_EAST: staffList.find((s) => s.email === 'officer.se@viju.local'),
    NORTH:      staffList.find((s) => s.email === 'officer.north@viju.local'),
  };
  for (const c of customers.slice(1)) {
    const officer = officersByRegion[c.region];
    if (!officer) continue;
    await prisma.customer.update({
      where: { id: c.id },
      data: { assignedOfficerId: officer.id },
    });
    await prisma.customerOfficer.upsert({
      where: { customerId_staffId: { customerId: c.id, staffId: officer.id } },
      update: { isPrimary: true },
      create: { customerId: c.id, staffId: officer.id, isPrimary: true },
    });
  }

  // ─── 10 Stock items (shared catalogue) ──────────────────
  const stockProducts = [
    { name: 'Viju Apple Drink 400ml',     qty: 2500 },
    { name: 'Viju Orange Drink 400ml',    qty: 1800 },
    { name: 'Viju Pineapple Drink 400ml', qty: 2000 },
    { name: 'Viju Milk 330ml',            qty: 3200 },
    { name: 'Viju Milk 1L',               qty: 1500 },
    { name: 'Viju Yoghurt 200ml',         qty: 900  },
    { name: 'Viju Chocolate Drink 330ml', qty: 1100 },
    { name: 'Viju Wheat Drink 400ml',     qty: 700  },
    { name: 'Premium Groundnut Oil 5L',   qty: 450  },
    { name: 'Tomato Paste 400g x 12',     qty: 600  },
  ];

  for (let i = 0; i < stockProducts.length; i++) {
    const p = stockProducts[i];
    await prisma.stock.upsert({
      where: { erpId: `STK-${(i + 1).toString().padStart(3, '0')}` },
      update: { quantity: p.qty },
      create: {
        erpId: `STK-${(i + 1).toString().padStart(3, '0')}`,
        productName: p.name,
        quantity: p.qty,
      },
    });
  }

  // ─── 10 Purchases for customer1 (with PurchaseItems) ───
  const orderStatuses = ['DELIVERED', 'DELIVERED', 'DELIVERED', 'PROCESSING', 'DELIVERED', 'DELIVERED', 'PROCESSING', 'DELIVERED', 'PENDING', 'DELIVERED'] as const;
  const purchases: Purchase[] = [];
  for (let i = 0; i < 10; i++) {
    const product1 = stockProducts[i % stockProducts.length];
    const product2 = stockProducts[(i + 3) % stockProducts.length];
    const qty1 = 20 + i * 5;
    const qty2 = 10 + i * 2;
    const unit1 = 12500;
    const unit2 = 8500;
    const total = qty1 * unit1 + qty2 * unit2;
    const orderDate = new Date(2026, 2 + Math.floor(i / 3), 10 + (i % 20));

    const purchase = await prisma.purchase.create({
      data: {
        erpId: `VJ-2026-${(675 + i).toString()}`,
        customerId: customer1.id,
        orderDate,
        totalItems: qty1 + qty2,
        totalValue: total,
        status: orderStatuses[i],
        items: {
          create: [
            { productName: product1.name, quantity: qty1, unitPrice: unit1, lineTotal: qty1 * unit1 },
            { productName: product2.name, quantity: qty2, unitPrice: unit2, lineTotal: qty2 * unit2 },
          ],
        },
      },
    });
    purchases.push(purchase);
  }

  // ─── 10 Payments for customer1 ─────────────────────────
  let runningBalance = 1450500;
  for (let i = 0; i < 10; i++) {
    const amount = 50000 + i * 25000;
    runningBalance -= amount;
    await prisma.payment.create({
      data: {
        erpId: `PAY-2026-${(100 + i).toString()}`,
        customerId: customer1.id,
        date: new Date(2026, 2 + Math.floor(i / 3), 5 + (i % 20)),
        amount,
        reference: i % 5 === 0 ? 'Delivery Allowance' : `INV-${4400 + i}`,
        runningBalance,
      },
    });
  }

  // ─── 10 Support tickets (with one reply each) ──────────
  const ticketCategories = ['DELIVERY_ISSUE', 'ACCOUNT_QUERY', 'PRODUCT_QUERY', 'OTHER'] as const;
  const ticketStatuses = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
  const subjects = [
    'Delivery delay on order VJ-2026-675',
    'Invoice correction request',
    'Damaged cartons received',
    'Wallet balance not updated',
    'Loading scheduled date moved',
    'Wrong product delivered',
    'Refund request for cancelled order',
    'Stock not updated after loading',
    'Need clarification on delivery allowance',
    'Issue with payment reference',
  ];

  for (let i = 0; i < 10; i++) {
    const ticket = await prisma.supportTicket.create({
      data: {
        ticketId: `TK-${(41 + i).toString().padStart(4, '0')}`,
        customerId: customer1.id,
        category: ticketCategories[i % ticketCategories.length],
        subject: subjects[i],
        description: `Auto-generated test ticket #${i + 1} for ${subjects[i]}. Used for QA list rendering.`,
        status: ticketStatuses[i],
      },
    });

    await prisma.ticketReply.create({
      data: {
        ticketId: ticket.id,
        senderType: 'STAFF',
        staffId: lagosOfficer.id,
        content: `Hello, we've received your ticket "${subjects[i]}" and are looking into it.`,
      },
    });
  }

  // ─── 10 Chat messages with primary officer ─────────────
  const chatLines = [
    'Good afternoon sir, I hope you are doing okay. Kindly confirm the payment we made yesterday.',
    'Confirm, I also updated your April statement, do well to confirm it please. Thanks.',
    'Can we get more chocolate drink this week?',
    'Yes, the truck is being prepared. ETA tomorrow 10am.',
    'Please send the loading bill for VJ-2026-678.',
    'Sent via the app — check your waybill tab.',
    'Thanks. Also, the 50k delivery allowance — has it reflected?',
    'Yes, posted this morning. Your wallet is updated.',
    'Appreciated. One last thing — invoice INV-4405?',
    'Will share before close of business today.',
  ];
  for (let i = 0; i < chatLines.length; i++) {
    await prisma.message.create({
      data: {
        customerId: customer1.id,
        staffId: lagosOfficer.id,
        senderType: i % 2 === 0 ? 'CUSTOMER' : 'STAFF',
        content: chatLines[i],
        readAt: i < chatLines.length - 2 ? new Date() : null,
      },
    });
  }

  // ─── 10 Loading requests ───────────────────────────────
  const loadingStatuses: LoadingRequestStatus[] = [
    'COMPLETED',
    'COMPLETED',
    'LOADING_IN_PROGRESS',
    'PENDING_ASSIGNMENT',
    'COMPLETED',
    'LOADING_IN_PROGRESS',
    'LOADING_IN_PROGRESS',
    'COMPLETED',
    'PENDING_ASSIGNMENT',
    'ASSIGNED',
  ];

  for (let i = 0; i < 10; i++) {
    const status = loadingStatuses[i];
    const isAssigned = status !== 'PENDING_ASSIGNMENT';
    const isCompleted = status === 'COMPLETED';
    const purchase = purchases[i];

    await prisma.loadingRequest.create({
      data: {
        reference: `WB-${(19045 + i).toString()}`,
        customerId: customer1.id,
        region: 'LAGOS',
        linkedPurchaseId: purchase.id,
        truckPlateNumber: `LAG-${234 + i}-XY`,
        driverName: ['Jimoh Ibrahim', 'John Dare', 'Tunde Dare', 'Musa Aliyu'][i % 4],
        driverPhone: `+23480${(80000000 + i).toString()}`,
        requestedLoadingDate: new Date(2026, 3, 15 + i),
        quantityCartons: 120 + i * 10,
        destination: ['Yaba Warehouse', 'Ikeja Depot', 'Apapa Warehouse'][i % 3],
        termsAcceptedAt: new Date(2026, 3, 14 + i),
        status,
        assignedOfficerId: isAssigned ? lagosLoader.id : null,
        assignedAt: isAssigned ? new Date(2026, 3, 14 + i, 14) : null,
        assignedById: isAssigned ? staffList.find((s) => s.role === 'REGIONAL_ADMIN' && s.region === 'LAGOS')?.id : null,
        loadingStartedAt: isCompleted || status === 'LOADING_IN_PROGRESS' ? new Date(2026, 3, 15 + i, 9) : null,
        completedAt: isCompleted ? new Date(2026, 3, 15 + i, 12) : null,
        waybillDocumentUrl: isCompleted ? `https://example.com/waybills/WB-${19045 + i}.pdf` : null,
      },
    });
  }

  // ─── 10 Notifications for customer1 ────────────────────
  const notifications = [
    'Your loading request WB-19045 has been completed.',
    'New chat reply from your Viju Account Officer.',
    'Your ticket TK-0041 status is now: In Progress',
    'Delivery allowance of ₦50,000 has been credited to your wallet.',
    'Your loading request WB-19046 has been assigned. Estimated date: 15 Apr.',
    'New stock of Viju Chocolate is available from Monday.',
    'Your invoice INV-4405 has been issued.',
    'Your ticket TK-0044 status is now: Resolved',
    'Your loading status is now: Loading in Progress',
    'Your loading request WB-19052 is awaiting assignment.',
  ];
  for (const content of notifications) {
    await prisma.notification.create({
      data: {
        customerId: customer1.id,
        content,
        isRead: Math.random() > 0.5,
        type: 'PRD_TRIGGER',
      },
    });
  }

  // ─── Light data for the OTHER 9 customers ──────────────
  // Each gets one purchase + one ticket + one chat message so the
  // /officers/customers dashboard table renders meaningful rows
  // (last purchase date, open ticket count, last contact date).
  const otherCustomers = customers.slice(1);
  for (let i = 0; i < otherCustomers.length; i++) {
    const c = otherCustomers[i];
    const officer = await prisma.customerOfficer.findFirst({
      where: { customerId: c.id, isPrimary: true },
    });
    if (!officer) continue;

    const daysAgo = (i + 1) * 3;
    const orderDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const product = stockProducts[i % stockProducts.length];

    const purchase = await prisma.purchase.create({
      data: {
        erpId: `${c.erpId}-ORD-001`,
        customerId: c.id,
        orderDate,
        totalItems: 1,
        totalValue: 250000 + i * 15000,
        status: i % 3 === 0 ? 'PROCESSING' : 'DELIVERED',
      },
    });
    await prisma.purchaseItem.create({
      data: {
        purchaseId: purchase.id,
        productName: product.name,
        quantity: 10 + i,
        unitPrice: 12500,
        lineTotal: (10 + i) * 12500,
      },
    });

    await prisma.payment.create({
      data: {
        erpId: `${c.erpId}-PAY-001`,
        customerId: c.id,
        date: new Date(orderDate.getTime() + 24 * 60 * 60 * 1000),
        amount: 100000,
        reference: `PAY-${c.erpId}`,
        runningBalance: c.outstandingBalance,
      },
    });

    if (i % 2 === 0) {
      await prisma.supportTicket.create({
        data: {
          ticketId: `TKT-${c.erpId}-001`,
          customerId: c.id,
          category: 'DELIVERY_ISSUE',
          subject: `Delivery delay on ${product.name}`,
          description: 'Need an update on my pending loading.',
          status: 'OPEN',
        },
      });
    }

    await prisma.message.create({
      data: {
        customerId: c.id,
        staffId: officer.staffId,
        senderType: 'CUSTOMER',
        content: `Hello, please confirm my latest payment for ${product.name}.`,
      },
    });
  }

  // Suppress 'unused' warning for adminUser (kept for future audit-log seeds)
  void adminUser;

  console.log('✅ Seed complete.\n');
  console.log('📋 CUSTOMER LOGINS (password: ' + CUSTOMER_PASSWORD + ')');
  for (const c of customerSeeds) {
    const tag =
      c.phone === MAIN_TEST_PHONE
        ? '← MAIN test: 10x of every entity'
        : c.accountStatus === 'ON_HOLD'
          ? '(on hold)'
          : '';
    console.log(
      `   ${c.phone.padEnd(16)} ${c.region.padEnd(11)} ${c.name.padEnd(28)} ${tag}`,
    );
  }
  console.log('');
  console.log('📋 STAFF LOGINS (password: ' + STAFF_PASSWORD + ')');
  for (const s of staffSeeds) {
    console.log(`   ${s.email.padEnd(32)} ${s.role.padEnd(18)} ${s.region ?? '—'}`);
  }
  console.log('\n📋 PRIMARY OFFICER for ' + MAIN_TEST_PHONE + ': officer.lagos@viju.local');
  console.log('📋 SECONDARY OFFICER:                  officer.sw@viju.local\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
