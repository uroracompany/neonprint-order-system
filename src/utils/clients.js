export const CLIENT_SELECT_COLUMNS = "id,name,phone,email,address,notes,deleted_at,deleted_by,deletion_reason,created_at,updated_at";
export const NO_CLIENT_FILTER_VALUE = "__no_client__";

export const normalizeClientText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const normalizeClientPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

export const formatDominicanPhone = (value) => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length > 10) digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const formatClientPhoneForStorage = (value) => {
  const normalized = normalizeClientPhone(value);
  return formatDominicanPhone(normalized || value);
};

const CLIENT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const buildClientPayload = (form, { userId = null, includeCreatedBy = false } = {}) => {
  const payload = {
    name: String(form?.name || "").trim(),
    phone: formatClientPhoneForStorage(form?.phone || ""),
    email: String(form?.email || "").trim() || null,
    address: String(form?.address || "").trim() || null,
    notes: String(form?.notes || "").trim() || null,
  };

  if (includeCreatedBy) payload.created_by = userId || null;
  return payload;
};

export const validateClientPayload = (payload) => {
  const errors = {};
  const name = String(payload?.name || "").trim();
  const phone = String(payload?.phone || "").trim();
  const phoneDigits = normalizeClientPhone(phone);
  const email = String(payload?.email || "").trim();

  if (!name) {
    errors.name = "Escribe el nombre del cliente.";
  } else if (name.length < 2) {
    errors.name = "El nombre debe tener al menos 2 caracteres.";
  }

  if (!phone) {
    errors.phone = "Escribe el numero de telefono del cliente.";
  } else if (phoneDigits.length < 3) {
    errors.phone = "El telefono debe tener al menos 3 digitos.";
  }

  if (email && !CLIENT_EMAIL_PATTERN.test(email)) {
    errors.email = "Escribe un correo valido.";
  }

  return errors;
};

export const validateClientForm = (form, options) => {
  const payload = buildClientPayload(form, options);
  return {
    payload,
    errors: validateClientPayload(payload),
  };
};

export const getClientDisplayName = (client) => {
  if (!client) return "Cliente sin nombre";
  const phone = String(client.phone || "").trim();
  return phone ? `${client.name} - ${phone}` : client.name;
};

export const clientMatchesQuery = (client, query) => {
  const normalizedQuery = normalizeClientText(query);
  const phoneQuery = normalizeClientPhone(query);
  if (!normalizedQuery && !phoneQuery) return true;

  return (
    normalizeClientText(client?.name).includes(normalizedQuery) ||
    normalizeClientText(client?.phone).includes(normalizedQuery) ||
    Boolean(phoneQuery && normalizeClientPhone(client?.phone).includes(phoneQuery))
  );
};

export const filterClientsByQuery = (clients, query, limit = 20) =>
  (clients || [])
    .filter((client) => clientMatchesQuery(client, query))
    .slice(0, limit);

export const orderMatchesClientFilter = (order, clientFilter) => {
  if (!clientFilter || clientFilter === "all") return true;
  if (clientFilter === NO_CLIENT_FILTER_VALUE) return !order?.client_id;
  return order?.client_id === clientFilter;
};

export const getSelectedClientOrderFields = (client, phoneField = "client_phone") => {
  if (!client) return { client_id: null };

  return {
    client_id: client.id,
    client_name: client.name || "",
    [phoneField]: client.phone || "",
  };
};

export const loadClients = async (supabase) => {
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SELECT_COLUMNS)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.warn("No se pudieron cargar los clientes:", error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
};

const sanitizeSearchTerm = (value) =>
  String(value || "")
    .replace(/[,%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const searchClients = async (supabase, query = "", limit = 20) => {
  const textTerm = sanitizeSearchTerm(query);
  const phoneTerm = normalizeClientPhone(query);

  const runQuery = async (includePhoneDigits = false) => {
    let request = supabase
      .from("clients")
      .select(CLIENT_SELECT_COLUMNS)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(limit);

    if (textTerm || phoneTerm) {
      const filters = [];
      if (textTerm) {
        filters.push(`name.ilike.%${textTerm}%`);
        filters.push(`phone.ilike.%${textTerm}%`);
      }
      if (phoneTerm) {
        filters.push(`phone.ilike.%${phoneTerm}%`);
        if (includePhoneDigits) filters.push(`phone_digits.ilike.%${phoneTerm}%`);
      }
      request = request.or(filters.join(","));
    }

    return request;
  };

  let { data, error } = await runQuery(false);

  if (!error && (!data || data.length === 0) && phoneTerm.length >= 4) {
    const retry = await runQuery(true);
    if (!retry.error) {
      data = retry.data;
      error = retry.error;
    } else if (!String(retry.error.message || "").includes("phone_digits")) {
      error = retry.error;
    }
  }

  if (error) {
    throw new Error(error.message || "No se pudieron buscar clientes.");
  }

  return Array.isArray(data) ? data : [];
};
