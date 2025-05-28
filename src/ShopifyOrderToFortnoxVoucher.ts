import { Order, Config, Voucher, VoucherRow } from "./types";

export interface OrderGroup {
  date: string;
  country: string;
  orders: Order[];
}

export function groupOrdersByDateAndCountry(orders: Order[]): OrderGroup[] {
  // This grouped contains bulk order record
  const grouped: Record<string, Order[]> = {};
  for (const order of orders) {
    const key = `${order.created_at}:${order.currency}`;
    grouped[key] = grouped[key] || [];
    grouped[key].push(order);
  }
  return Object.entries(grouped).map(([key, items]) => {
    const [date] = key.split(":");
    return {
      date,
      country: "XX",
      orders: items,
    };
  });
}

export function getOrdersGroupToVoucher({
  groupedOrders,
  config,
}: {
  groupedOrders: OrderGroup;
  config: Config;
}): { voucher: Voucher; totalDebit: number; totalCredit: number } {
  const vatTotals: Record<number, { sales_net: number; sales_vat: number }> =
    {};
  groupedOrders.orders.forEach((order) => {
    order.line_items.forEach((item) => {
      item.tax_lines.forEach((tax) => {
        const vatRate = tax.rate; // 0.25
        const itemTotalPrice = item.price * item.quantity; // 100 * 1
        const vatAmount = tax.price; // 20
        const netAmount = order.taxes_included
          ? itemTotalPrice - vatAmount
          : itemTotalPrice; // 80
        if (!vatTotals[vatRate]) {
          vatTotals[vatRate] = { sales_net: 0, sales_vat: 0 };
        }
        vatTotals[vatRate].sales_net += netAmount;
        vatTotals[vatRate].sales_vat += vatAmount;
      });
    });

    // TODO: distribute shipping lines across VAT rates proportionally
    //       Update vatTotals so shipping cost is allocated to the same VAT
    //       percentages as the line items.

    /** Assumeing senario of CASE
     * pesudocode: Need to proportionate the shipping charge
     * 1. Calculate Net Sales
     * 2. Total shipping charges with TAX
     * 3. Allocate VAT proportion of the sum shipping to thier proportion of the line items VAT tax percentage 
     * 
     */

    // Fetching Total net sales
    const totalNet = Object.values(vatTotals).reduce((sum, vat) => sum + vat.sales_net, 0);

    // Fetching Totat shipping charges for the order
    const totalShipping = groupedOrders.orders.reduce(
      (sum, order) => sum + order.shipping_lines.reduce((s, sl) => s + sl.price, 0),
      0
    );

    // Distribute shipping across VAT rates proportionally
    for (const rate in vatTotals) {
      //  Getting Vat share from the totalNet sales 
      const share = vatTotals[rate].sales_net / totalNet;
      // Getting Shipping charge for each line_items
      const shippingShare = (totalShipping * share).toFixed(2);
      const vatRate = parseFloat(rate);
      // Getting VAT contribution towards shipping
      const vatPart = (parseFloat(shippingShare) * (vatRate / (1 + vatRate))).toFixed(2);
      // Net Shipping Cost without tax 
      const netPart = order.taxes_included ? parseFloat(shippingShare) - parseFloat(vatPart): parseFloat(shippingShare);

      vatTotals[rate].sales_net += netPart;
      vatTotals[rate].sales_vat += parseFloat(vatPart);
    }

  });

  const rows: VoucherRow[] = [
    {
      Account: config.accounts.order_receivables,
      Debit: groupedOrders.orders.reduce((s, o) => s + o.total_price, 0),
      TransactionInformation: "Receivables",
      Quantity: 1,
    },
  ];

  if (vatTotals[0.25]) {
    rows.push({
      Account: config.accounts.sales_revenue_25,
      Credit: vatTotals[0.25].sales_net,
      TransactionInformation: "Sales Revenue 25%",
      Quantity: 1,
    });
    rows.push({
      Account: config.accounts.output_vat_25,
      Credit: vatTotals[0.25].sales_vat,
      TransactionInformation: "Output VAT 25%",
      Quantity: 1,
    });
  }

  if (vatTotals[0.12]) {
    rows.push({
      Account: config.accounts.sales_revenue_12,
      Credit: vatTotals[0.12].sales_net,
      TransactionInformation: "Sales Revenue 12%",
      Quantity: 1,
    });
    rows.push({
      Account: config.accounts.output_vat_12,
      Credit: vatTotals[0.12].sales_vat,
      TransactionInformation: "Output VAT 12%",
      Quantity: 1,
    });
  }

  if (config.accounts.order_shipping) {
    const shipping = groupedOrders.orders.reduce(
      (sum, order) =>
        sum + order.shipping_lines.reduce((s, sl) => s + sl.price, 0),
      0
    );
    if (shipping > 0) {
      rows.push({
        Account: config.accounts.order_shipping,
        Credit: shipping,
        TransactionInformation: "Shipping",
        Quantity: 1,
      });
    }
  }

  const voucher: Voucher = {
    VoucherRows: rows,
  };

  const totalDebit = rows.reduce((sum, row) => sum + (row.Debit || 0), 0);
  const totalCredit = rows.reduce((sum, row) => sum + (row.Credit || 0), 0);

  return { voucher, totalDebit, totalCredit };
}
