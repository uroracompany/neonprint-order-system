export const getAvatarInitials = (name) => {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  const initials = words.length > 1
    ? words.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")
    : [...(words[0] || "")].slice(0, 2).join("").toUpperCase();

  return initials.padEnd(2, "?");
};
