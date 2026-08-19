import { BpClusterCode } from '../../common/region/region.constants';

/**
 * The ERP identifies a business partner's region with the numeric
 * BP_CLUSTER_CODE. It is carried on these contracts unchanged and translated
 * into the `Region` enum by consumers via `regionFromBpClusterCode()` - see
 * src/common/region/region.constants.ts. No caller should branch on the
 * number itself.
 */
export interface ErpCustomerProfile {
  erpId: string;
  name: string;
  phone: string;
  email?: string;
  /** BP_CLUSTER_CODE (1-5). Map with `regionFromBpClusterCode()`. */
  bpClusterCode: BpClusterCode;
  accountStatus: 'ACTIVE' | 'ON_HOLD';
}

export interface ErpWalletBalance {
  erpId: string;
  balance: number;
  lastUpdatedAt: Date;
}

export interface ErpStockBalanceLine {
  productName: string;
  quantityPaid: number;
  quantityLoaded: number;
  quantityRemaining: number;
}

export interface ErpStockBalance {
  erpId: string;
  totalCartonsAwaitingLoading: number;
  byProduct: ErpStockBalanceLine[];
  lastUpdatedAt: Date;
}

export interface ErpInvoiceLine {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ErpInvoice {
  invoiceNumber: string;
  date: Date;
  totalAmount: number;
  amountPaid: number;
  outstandingAmount: number;
  status: 'PAID' | 'UNPAID' | 'PART_PAID';
  lines: ErpInvoiceLine[];
}

export interface ErpPurchaseLine {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ErpPurchase {
  orderId: string;
  date: Date;
  totalItems: number;
  totalValue: number;
  status: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  linkedInvoiceNumber?: string;
  lines: ErpPurchaseLine[];
}

export interface ErpPayment {
  date: Date;
  amount: number;
  reference: string;
  runningBalance: number;
}

export interface ErpStaffCredential {
  username: string;
  erpCode: string;
  name: string;
  email: string;
  phone: string;
  role:
    | 'OFFICER'
    | 'ADMIN'
    | 'REGIONAL_ADMIN'
    | 'LOADING_OFFICER'
    | 'WAREHOUSE_OFFICER';
  /** BP_CLUSTER_CODE (1-5). Absent for staff with no regional posting. */
  bpClusterCode?: BpClusterCode;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

export abstract class ErpService {
  abstract findCustomerByPhone(
    phone: string,
  ): Promise<ErpCustomerProfile | null>;
  abstract getCustomerProfile(
    erpId: string,
  ): Promise<ErpCustomerProfile | null>;
  abstract getWalletBalance(erpId: string): Promise<ErpWalletBalance>;
  abstract getStockBalance(erpId: string): Promise<ErpStockBalance>;
  abstract getInvoices(erpId: string, range?: DateRange): Promise<ErpInvoice[]>;
  abstract getPurchases(
    erpId: string,
    range?: DateRange,
  ): Promise<ErpPurchase[]>;
  abstract getPayments(erpId: string, range?: DateRange): Promise<ErpPayment[]>;
  abstract validateStaffCredentials(
    username: string,
    erpCode: string,
  ): Promise<ErpStaffCredential | null>;
}
