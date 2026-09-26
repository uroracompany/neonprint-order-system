import { Icons } from "../../utils/icons";
import "./ProfilePeriodControl.css";

const PERIOD_OPTIONS = [
  { value: "all", label: "Todo el historial" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "30d", label: "Ultimos 30 dias" },
  { value: "month", label: "Mes actual" },
  { value: "year", label: "Ano actual" },
];

export default function ProfilePeriodControl({ value, onChange }) {
  return (
    <label className="profile-period-control">
      <Icons.Calendar aria-hidden="true" />
      <span>Periodo</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Periodo del perfil">
        {PERIOD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
