export function getProductionUserDisplayName(authUser, authProfile) {
  const candidates = [
    authProfile?.name,
    authUser?.user_metadata?.full_name,
    authUser?.user_metadata?.name,
    authUser?.email,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "Usuario de producción";
}
