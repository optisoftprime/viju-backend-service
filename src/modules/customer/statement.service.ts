import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import PDFDocument from 'pdfkit';

export interface StatementRange {
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class StatementService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAccountStatement(
    customerId: string,
    range: StatementRange,
  ): Promise<Buffer> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        name: true,
        phone: true,
        erpId: true,
        outstandingBalance: true,
        region: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const where = {
      customerId,
      ...(range.startDate || range.endDate
        ? {
            date: {
              ...(range.startDate ? { gte: new Date(range.startDate) } : {}),
              ...(range.endDate ? { lte: new Date(range.endDate) } : {}),
            },
          }
        : {}),
    };

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { date: 'asc' },
      select: {
        date: true,
        amount: true,
        reference: true,
        runningBalance: true,
      },
    });

    const purchases = await this.prisma.purchase.findMany({
      where: {
        customerId,
        ...(range.startDate || range.endDate
          ? {
              orderDate: {
                ...(range.startDate ? { gte: new Date(range.startDate) } : {}),
                ...(range.endDate ? { lte: new Date(range.endDate) } : {}),
              },
            }
          : {}),
      },
      orderBy: { orderDate: 'asc' },
      select: { erpId: true, orderDate: true, totalValue: true, status: true },
    });

    return this.renderPdf((doc) => {
      doc.fontSize(20).text('Viju — Account Statement', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Distributor: ${customer.name}`);
      doc.text(`ERP ID: ${customer.erpId}`);
      doc.text(`Phone: ${customer.phone}`);
      doc.text(`Region: ${customer.region}`);
      doc.text(
        `Range: ${range.startDate ?? 'beginning'}  →  ${range.endDate ?? 'now'}`,
      );
      doc.moveDown();

      doc.fontSize(13).text('Invoices in period', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const p of purchases) {
        doc.text(
          `${p.orderDate.toISOString().slice(0, 10)}   ${p.erpId.padEnd(16)} ` +
            `${this.money(p.totalValue).padStart(15)}   ${p.status}`,
        );
      }
      if (purchases.length === 0) doc.text('— none —');
      doc.moveDown();

      doc.fontSize(13).text('Payments in period', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const pmt of payments) {
        doc.text(
          `${pmt.date.toISOString().slice(0, 10)}   ${(pmt.reference ?? '').padEnd(20)} ` +
            `${this.money(pmt.amount).padStart(15)}   bal ${this.money(pmt.runningBalance)}`,
        );
      }
      if (payments.length === 0) doc.text('— none —');
      doc.moveDown();

      doc
        .fontSize(11)
        .text(
          `Current wallet balance: ${this.money(customer.outstandingBalance)}`,
          { align: 'right' },
        );
    });
  }

  async generateStockStatement(
    customerId: string,
    range: StatementRange,
  ): Promise<Buffer> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, phone: true, erpId: true, region: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const purchases = await this.prisma.purchase.findMany({
      where: {
        customerId,
        ...(range.startDate || range.endDate
          ? {
              orderDate: {
                ...(range.startDate ? { gte: new Date(range.startDate) } : {}),
                ...(range.endDate ? { lte: new Date(range.endDate) } : {}),
              },
            }
          : {}),
      },
      orderBy: { orderDate: 'asc' },
      select: {
        erpId: true,
        orderDate: true,
        items: {
          select: { productName: true, quantity: true },
        },
        loadingRequests: {
          where: { status: 'COMPLETED' },
          select: { quantityCartons: true },
        },
      },
    });

    return this.renderPdf((doc) => {
      doc.fontSize(20).text('Viju — Stock Statement', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Distributor: ${customer.name}`);
      doc.text(`ERP ID: ${customer.erpId}`);
      doc.text(`Phone: ${customer.phone}`);
      doc.text(`Region: ${customer.region}`);
      doc.text(
        `Range: ${range.startDate ?? 'beginning'}  →  ${range.endDate ?? 'now'}`,
      );
      doc.moveDown();

      doc.fontSize(13).text('Orders / loading progress', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const p of purchases) {
        const paid = p.items.reduce((a, i) => a + i.quantity, 0);
        const loaded = p.loadingRequests.reduce(
          (a, r) => a + (r.quantityCartons ?? 0),
          0,
        );
        const remaining = Math.max(0, paid - loaded);
        doc.text(
          `${p.orderDate.toISOString().slice(0, 10)}   ${p.erpId.padEnd(16)} ` +
            `paid ${paid.toString().padStart(4)}   loaded ${loaded.toString().padStart(4)}   remaining ${remaining}`,
        );
        for (const item of p.items) {
          doc
            .fontSize(9)
            .text(
              `        - ${item.productName.padEnd(30)} qty ${item.quantity}`,
            );
        }
        doc.fontSize(10);
      }
      if (purchases.length === 0) doc.text('— none —');
    });
  }

  private renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        build(doc);
        doc.end();
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  private money(n: number): string {
    return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 4 });
  }
}
