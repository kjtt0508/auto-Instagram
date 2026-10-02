export function OrderView({ order }: { order: OrderViewModel }) {
  return <div className={order.statusClass()}>{order.totalText()}</div>;
}
