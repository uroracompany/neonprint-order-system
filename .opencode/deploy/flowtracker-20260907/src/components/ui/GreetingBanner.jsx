import "../../css-components/page-seller.css";

export default function GreetingBanner({ icon, title, subtitle, badges = [], actions, className = "" }) {
  return (
    <div className={`ps-greeting ${className}`.trim()}>
      <div className="ps-greeting-main">
        {icon ? <div className="ps-greeting-leading">{icon}</div> : null}
        <div className="ps-greeting-copy">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
          {badges.length > 0 ? (
            <div className="ps-greeting-badges">
              {badges.map((b, i) => (
                <span key={i} className={`ps-greeting-count ${b.variant ? `ps-greeting-count--${b.variant}` : ""}`.trim()} aria-label={b.ariaLabel}>
                  {b.icon}
                  {b.count != null ? <strong>{b.count}</strong> : null}
                  {b.label ? <span>{b.label}</span> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="ps-greeting-actions">{actions}</div> : null}
    </div>
  );
}
