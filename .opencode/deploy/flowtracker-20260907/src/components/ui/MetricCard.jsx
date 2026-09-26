import "../../css-components/page-seller.css";
import { Icons } from "../../utils/icons";

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#F1F5F9", glow: "#F1F5F9" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#8B5CF6", bg: "#EDE9FE", glow: "#EDE9FE" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
  { color: "#1E40AF", bg: "#dbeafe", glow: "#dbeafe" },
  { color: "#991b1b", bg: "#fef2f2", glow: "#fef2f2" },
];

export default function MetricCard({ icon, label, value, sub, accentIdx = 0, trend, subColor }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="ps-card">
      {trend !== undefined && <span className="ps-trend-badge"><Icons.TrendUp /> +{trend}%</span>}
      <div className="ps-card-icon" style={{ background: acc.bg, color: acc.color }}>{icon}</div>
      <div className="ps-card-value">{value}</div>
      <div className="ps-card-label">{label}</div>
      {sub && <div className="ps-card-sub" style={{ color: subColor || acc.color }}>{sub}</div>}
    </div>
  );
}

export { CARD_ACCENTS };
