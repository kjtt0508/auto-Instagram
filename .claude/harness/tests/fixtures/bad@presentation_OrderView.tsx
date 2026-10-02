// expect: common.ui-calculation, common.ui-status-branch
export function OrderView({ order }: { order: OrderResponse }) {
  const total = order.price * order.quantity;
  return <div className={order.status === "CANCELLED" ? "muted" : ""}>{total}</div>;
}
