import { Injectable, Logger } from '@nestjs/common';
import {
  DateRange,
  ErpCustomerProfile,
  ErpInvoice,
  ErpPayment,
  ErpPurchase,
  ErpService,
  ErpStaffCredential,
  ErpStockBalance,
  ErpWalletBalance,
} from './erp.types';

@Injectable()
export class MockErpService extends ErpService {
  private readonly logger = new Logger('MockErpService');

  findCustomerByPhone(phone: string): Promise<ErpCustomerProfile | null> {
    this.logger.debug(`[mock] findCustomerByPhone(${phone})`);
    return Promise.resolve({
      erpId: `VJ-${phone.slice(-6)}`,
      name: 'Ade Foods Ltd',
      phone,
      email: 'ade.foods@example.com',
      bpClusterCode: 1, // LAGOS
      accountStatus: 'ACTIVE',
    });
  }

  getCustomerProfile(erpId: string): Promise<ErpCustomerProfile | null> {
    return Promise.resolve({
      erpId,
      name: 'Ade Foods Ltd',
      phone: '08190987654',
      email: 'ade.foods@example.com',
      bpClusterCode: 1, // LAGOS
      accountStatus: 'ACTIVE',
    });
  }

  getWalletBalance(erpId: string): Promise<ErpWalletBalance> {
    return Promise.resolve({
      erpId,
      balance: 1_450_500,
      lastUpdatedAt: new Date(),
    });
  }

  getStockBalance(erpId: string): Promise<ErpStockBalance> {
    return Promise.resolve({
      erpId,
      totalCartonsAwaitingLoading: 420,
      byProduct: [
        {
          productName: 'Viju Milk 330ml',
          quantityPaid: 700,
          quantityLoaded: 280,
          quantityRemaining: 420,
        },
      ],
      lastUpdatedAt: new Date(),
    });
  }

  getInvoices(erpId: string, _range?: DateRange): Promise<ErpInvoice[]> {
    return Promise.resolve([
      {
        invoiceNumber: 'INV-4401',
        date: new Date('2026-04-22'),
        totalAmount: 1_365_500,
        amountPaid: 1_365_500,
        outstandingAmount: 0,
        status: 'PAID',
        lines: [
          {
            productName: 'Premium Groundnut Oil 5L',
            quantity: 20,
            unitPrice: 12_500,
            lineTotal: 250_000,
          },
        ],
      },
    ]);
  }

  getPurchases(erpId: string, _range?: DateRange): Promise<ErpPurchase[]> {
    return Promise.resolve([
      {
        orderId: 'VJ-2026-675',
        date: new Date('2026-03-08'),
        totalItems: 3,
        totalValue: 645_000,
        status: 'DELIVERED',
        linkedInvoiceNumber: 'INV-4401',
        lines: [
          {
            productName: 'V-smart chocolate 400ml',
            quantity: 3,
            unitPrice: 215_000,
            lineTotal: 645_000,
          },
        ],
      },
    ]);
  }

  getPayments(erpId: string, _range?: DateRange): Promise<ErpPayment[]> {
    return Promise.resolve([
      {
        date: new Date('2026-04-22'),
        amount: 1_365_500,
        reference: 'PAY-20260563-001',
        runningBalance: 1_450_500,
      },
    ]);
  }

  validateStaffCredentials(
    username: string,
    erpCode: string,
  ): Promise<ErpStaffCredential | null> {
    if (!username || !erpCode) return Promise.resolve(null);
    return Promise.resolve({
      username,
      erpCode,
      name: 'James Okonkwo',
      email: `${username}@viju.example`,
      phone: '+2348012345678',
      role: 'OFFICER',
      bpClusterCode: 1, // LAGOS
    });
  }
}
