import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { ClientSelect } from "../ui/ClientCombobox";
import FileUploadZone from "../ui/FileUploadZone";
import FileCard from "../FileCard";
import { normalizeAssetUrls, serializeReferenceImages } from "../../utils/orderAssets";
import { buildProductionFileRows } from "../../utils/production";
import {
  buildStorageSafeFileName,
  formatFileSize,
  uploadOrderAsset,
} from "../../utils/uploadOrderAsset";
import {
  canDecodeAsImage,
  compressImage,
  REF_IMAGE_CONFIG,
  validateReferenceImages,
} from "../../utils/imageValidation";
import { formatPhone, getSelectedClientOrderFields } from "../../utils/clients";
import { getMinimumDeliveryDate, isPastDeliveryDateChange } from "../../utils/deliveryDate";
import { adminApiFetch } from "../../utils/adminApi";
import { resolveOrderAssetUrl } from "../../utils/fileAccess";
import { SecureImage } from "../ui/SecureImage";
import {
  Field,
  Modal,
  PHONE_PLACEHOLDER,
  ProductionFileDetailsModal,
} from "./CreateOrderModal";
import "./EditOrderModal.css";

const SEMI_ADMIN_ASSET_EDITABLE_STATUSES = new Set([
  "Pending",
  "pending",
  "in_Design",
  "In_Design",
  "in_Quote",
  "in_Production",
  "in_Termination",
  "in_Completed",
]);
const SEMI_ADMIN_ACTIVE_FILE_LOCK_STATUSES = new Set(["in_Production", "in_Termination", "in_Completed"]);

export default function EditOrderModal({
  open,
  onClose,
  order,
  onUpdated,
  onAssetSaved,
  productionCatalog = {},
  clients = [],
  clientsLoading = false,
  onClientSearch,
  editMode = "admin",
  lockClientIdentity = false,
  assetsOnly = false,
  requireWorkOrder = false,
  semiAdminVariant = false,
  keepOpenAfterAssetSave = false,
}) {
  const fileInputRef = useRef(null);
  const previewInputRef = useRef(null);
  const refImagesInputRef = useRef(null);

  const [form, setForm] = useState({
    client_id: null,
    client_name: "",
    client_contact: "",
    invoice_number: "",
    description: "",
    materials: [],
    termination_type: "",
    delivery_date: "",
  });
  const [existingFiles, setExistingFiles] = useState([]);
  const [existingFileRows, setExistingFileRows] = useState([]);
  const [existingFileReplacements, setExistingFileReplacements] = useState({});
  const [newFiles, setNewFiles] = useState([]);
  const [newFileAreas, setNewFileAreas] = useState([]);
  const [newFileLabels, setNewFileLabels] = useState([]);
  const [newFileMaterials, setNewFileMaterials] = useState([]);
  const [newFileTerminations, setNewFileTerminations] = useState([]);
  const [existingPreview, setExistingPreview] = useState(null);
  const [resolvedExistingPreview, setResolvedExistingPreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [newPreview, setNewPreview] = useState(null);
  const [existingRefImages, setExistingRefImages] = useState([]);
  const [newRefImages, setNewRefImages] = useState([]);
  const [assetVersion, setAssetVersion] = useState(null);
  const [assetRemovalLoading, setAssetRemovalLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [missingLabelIndices, setMissingLabelIndices] = useState([]);
  const [missingAreaIndices, setMissingAreaIndices] = useState([]);
  const [pendingDetailsIndices, setPendingDetailsIndices] = useState([]);
  const [detailsFileIndex, setDetailsFileIndex] = useState(null);
  const [detailsExistingFileIndex, setDetailsExistingFileIndex] = useState(null);
  const existingFileReplaceInputRef = useRef(null);
  const [replaceExistingFileIndex, setReplaceExistingFileIndex] = useState(null);
  const isSellerEdit = editMode === "seller";
  const isSemiAdminAssetEdit = Boolean(isSellerEdit && semiAdminVariant && assetsOnly);
  const isSellerEditBlocked = isSellerEdit && (isSemiAdminAssetEdit
    ? !SEMI_ADMIN_ASSET_EDITABLE_STATUSES.has(order?.status)
    : ["in_Quote", "cancelled", "in_Delivered"].includes(order?.status));
  const canEditAssets = !isSellerEditBlocked && (isSellerEdit || (
    (order?.order_design_type === "INTERNAL_DESING" && order?.status === "in_Design")
    || (order?.order_design_type === "EXTERNAL_DESING" && order?.status === "Pending")
  ));
  const canMutateExistingAsset = (row) => {
    if (!isSemiAdminAssetEdit || !SEMI_ADMIN_ACTIVE_FILE_LOCK_STATUSES.has(order?.status)) return true;
    return String(row?.status || "").toLowerCase() === "pending";
  };
  const canMutateStandaloneAsset = !isSemiAdminAssetEdit || !SEMI_ADMIN_ACTIVE_FILE_LOCK_STATUSES.has(order?.status);
  const existingPreviewLocked = Boolean(isSemiAdminAssetEdit && existingPreview && !canMutateStandaloneAsset);
  const assetWorkflowMessage = order?.order_design_type === "INTERNAL_DESING"
    ? "El estado productivo está protegido. Puedes gestionar archivos y especificaciones permitidas; para cambiar la etapa, devuelve la orden a Diseño desde Configuración avanzada."
    : "El estado productivo está protegido. Puedes gestionar archivos y especificaciones permitidas; para cambiar la etapa, devuelve la orden a Ventas desde Configuración avanzada.";

  useEffect(() => {
    if (!order) return;

    setForm({
      client_id: order.client_id || null,
      client_name: order.client_name || "",
      client_contact: order.client_contact || "",
      invoice_number: order.invoice_number || "",
      description: order.description || "",
      materials: [],
      termination_type: "",
      delivery_date: order.delivery_date ? order.delivery_date.split("T")[0] : "",
    });

    const legacyUrls = normalizeAssetUrls(order.order_file_url);
    const normalizedProductionFiles = Array.isArray(order.order_production_files)
      ? order.order_production_files
        .map((file, index) => ({
          id: file?.id || `existing-${index}`,
          url: file?.url || file?.file_url || "",
          filename: file?.filename || file?.name || parseFileName(file?.url || file?.file_url || ""),
          public_label: file?.public_label || "",
          production_area_code: file?.production_area_code || "",
          material_names: Array.isArray(file?.material_names) ? file.material_names : [],
          termination_name: file?.termination_name || "",
          status: file?.status || "pending",
        }))
        .filter((file) => file.url)
      : [];
    const productionUrls = new Set(normalizedProductionFiles.map((file) => file.url));
    const normalizedFiles = [
      ...normalizedProductionFiles,
      ...legacyUrls.filter((url) => !productionUrls.has(url)).map((url, index) => ({
        id: `legacy-${index}`,
        url,
        filename: parseFileName(url),
        public_label: "",
        production_area_code: "",
        material_names: [],
        termination_name: "",
        status: "pending",
      })),
    ];
    setExistingFileRows(normalizedFiles);
    setExistingFiles(normalizedFiles.map((file) => file.url));
    setExistingFileReplacements({});
    setExistingPreview(order.preview_image || null);
    setResolvedExistingPreview("");
    setPreviewLoading(false);
    setPreviewError("");
    setExistingRefImages(normalizeAssetUrls(order.reference_images));
    setNewFiles([]);
    setNewFileAreas([]);
    setNewFileLabels([]);
    setNewFileMaterials([]);
    setNewFileTerminations([]);
    setPendingDetailsIndices([]);
    setDetailsFileIndex(null);
    setDetailsExistingFileIndex(null);
    setReplaceExistingFileIndex(null);
    setNewPreview(null);
    setNewRefImages([]);
    setAssetVersion(order.updated_at || null);
    setAssetRemovalLoading(false);
    setFieldErrors({});
    setError("");
  }, [order]);

  useEffect(() => {
    let active = true;

    if (!existingPreview) {
      setResolvedExistingPreview("");
      setPreviewLoading(false);
      setPreviewError("");
      return () => { active = false; };
    }

    setPreviewLoading(true);
    setPreviewError("");
    setResolvedExistingPreview("");
    resolveOrderAssetUrl(existingPreview)
      .then((url) => {
        if (!url) throw new Error("No se pudo cargar la Orden de Trabajo.");
        if (active) setResolvedExistingPreview(url);
      })
      .catch((resolutionError) => {
        if (active) setPreviewError(resolutionError?.message || "No se pudo cargar la Orden de Trabajo.");
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => { active = false; };
  }, [existingPreview]);

  const set = (key, value) => {
    setForm(previous => ({ ...previous, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };

  const applySelectedClient = (client) => {
    if (lockClientIdentity) return;
    if (!client) {
      setForm(previous => ({ ...previous, ...getSelectedClientOrderFields(null, "client_contact") }));
      return;
    }

    const fields = getSelectedClientOrderFields(client, "client_contact");
    if (fields.client_contact) fields.client_contact = formatPhone(fields.client_contact);

    setForm(previous => ({ ...previous, ...fields }));
    setFieldErrors(previous => {
      const next = { ...previous };
      delete next.client_id;
      delete next.client_name;
      delete next.client_contact;
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};

    if (!assetsOnly) {
      if (!form.client_id) {
        errors.client_id = "Debes seleccionar un cliente registrado.";
      }
      if (!form.client_name.trim()) {
        errors.client_name = "Selecciona un cliente registrado para completar el nombre.";
      }
      if (!form.client_contact.trim()) {
        errors.client_contact = "Selecciona un cliente registrado con telefono.";
      }
      if (!form.description.trim()) {
        errors.description = "La descripcion es requerida.";
      }
      if (order?.delivery_date && !form.delivery_date) {
        errors.delivery_date = "La fecha de entrega existente no puede quedar vacia.";
      }
      if (isPastDeliveryDateChange(form.delivery_date, order?.delivery_date)) {
        errors.delivery_date = "La fecha de entrega no puede ser anterior a hoy.";
      }
    }
    if (newFiles.length > 0) {
      const missingAreas = newFileAreas
        .map((area, index) => (!area ? index : -1))
        .filter(index => index !== -1);
      const missingLabels = newFileLabels
        .map((label, index) => (!label?.trim() ? index : -1))
        .filter(index => index !== -1);

      setMissingAreaIndices(missingAreas);
      setMissingLabelIndices(missingLabels);

      const missingSpecifications = newFileAreas
        .map((_, index) => (!newFileMaterials[index]?.length || !newFileTerminations[index]?.trim() ? index : -1))
        .filter(index => index !== -1);

      const messages = [];
      if (missingAreas.length > 0) messages.push("un tipo de produccion");
      if (missingLabels.length > 0) messages.push("un nombre de representacion");
      if (missingSpecifications.length > 0) messages.push("materiales y terminacion");
      if (messages.length > 0) {
        errors.order_files = `Cada archivo nuevo debe tener ${messages.join(" y ")}.`;
      }
    } else {
      setMissingAreaIndices([]);
      setMissingLabelIndices([]);
    }
    if (requireWorkOrder && !existingPreview && !newPreview) {
      errors.order_work = "La Orden de Trabajo es obligatoria. Adjunta la Orden de Trabajo antes de continuar.";
    }
    return errors;
  };

  const persistAssetRemoval = async ({ urls, nextFiles = existingFiles, nextPreview = existingPreview, nextRefImages = existingRefImages }) => {
    if (!canEditAssets) {
      setError(assetWorkflowMessage);
      return false;
    }
    if (assetRemovalLoading || loading) return false;

    const removedUrls = [...new Set(urls.filter(Boolean))];
    if (removedUrls.length === 0) return true;

    const previousState = {
      files: existingFiles,
      preview: existingPreview,
      refImages: existingRefImages,
      version: assetVersion,
    };
    setExistingFiles(nextFiles);
    setExistingPreview(nextPreview);
    setExistingRefImages(nextRefImages);
    setAssetRemovalLoading(true);
    setError("");

    try {
      const { response, result } = await adminApiFetch("/api/seller-orders", {
        action: "update",
        order_id: order.id,
        expected_updated_at: assetVersion || order.updated_at,
        changes: {
          order_file_url: JSON.stringify(nextFiles),
          preview_image: nextPreview,
          reference_images: nextRefImages.length > 0 ? serializeReferenceImages(nextRefImages) : [],
        },
        production_files: [],
        removed_file_urls: removedUrls,
        asset_operation: "manage_assets",
        asset_removal_only: true,
      });
      if (!response.ok) {
        throw new Error(result?.error || "No se pudo eliminar el archivo.");
      }
      const updatedOrder = result?.order || null;
      setAssetVersion(updatedOrder?.updated_at || assetVersion);
      try {
        await onUpdated?.(updatedOrder);
      } catch (refreshError) {
        console.warn("No se pudo refrescar la orden después de eliminar el archivo:", refreshError);
      }
      return true;
    } catch (removalError) {
      setExistingFiles(previousState.files);
      setExistingPreview(previousState.preview);
      setExistingRefImages(previousState.refImages);
      setAssetVersion(previousState.version);
      setError(removalError?.message || "No se pudo eliminar el archivo.");
      return false;
    } finally {
      setAssetRemovalLoading(false);
    }
  };

  const handleRemoveExistingFile = (url) => {
    const rowIndex = existingFileRows.findIndex((file) => file.url === url);
    if (rowIndex >= 0 && !canMutateExistingAsset(existingFileRows[rowIndex])) {
      setError("Este archivo ya está en proceso y no puede eliminarse en esta etapa.");
      return;
    }
    void persistAssetRemoval({
      urls: [url],
      nextFiles: existingFiles.filter(file => file !== url),
    });
    if (rowIndex >= 0) {
      setExistingFileRows((previous) => previous.filter((_, index) => index !== rowIndex));
      setExistingFileReplacements((previous) => {
        const next = {};
        Object.entries(previous).forEach(([key, value]) => {
          const currentIndex = Number(key);
          if (currentIndex < rowIndex) next[currentIndex] = value;
          if (currentIndex > rowIndex) next[currentIndex - 1] = value;
        });
        return next;
      });
    }
  };

  const handleReplaceExistingFile = (index, file) => {
    if (!file || !canEditAssets) return;
    if (!canMutateExistingAsset(existingFileRows[index])) {
      setError("Este archivo ya está en proceso y no puede reemplazarse en esta etapa.");
      return;
    }
    setExistingFileReplacements((previous) => ({ ...previous, [index]: file }));
    setError("");
  };

  const handleExistingFileReplaceInput = (event) => {
    const file = event.target.files?.[0];
    if (replaceExistingFileIndex !== null && file) {
      handleReplaceExistingFile(replaceExistingFileIndex, file);
    }
    event.target.value = "";
    setReplaceExistingFileIndex(null);
  };

  const handleAddNewFiles = (filesOrEvent) => {
    if (!canEditAssets) {
      setError(assetWorkflowMessage);
      return;
    }
    const files = Array.from(filesOrEvent?.target?.files || filesOrEvent || []);
    if (!files.length) return;

    setNewFiles(previous => [...previous, ...files]);
    setNewFileAreas(previous => [...previous, ...files.map(() => "")]);
    setNewFileLabels(previous => [...previous, ...files.map(() => "")]);
    setNewFileMaterials(previous => [...previous, ...files.map(() => [])]);
    setNewFileTerminations(previous => [...previous, ...files.map(() => "")]);
    const firstNewFileIndex = newFiles.length;
    setPendingDetailsIndices(previous => [
      ...previous,
      ...files.map((_, offset) => firstNewFileIndex + offset),
    ]);
    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };

  const handleRemoveNewFile = (index) => {
    setDetailsFileIndex(null);
    setPendingDetailsIndices(previous => previous
      .filter((pendingIndex) => pendingIndex !== index)
      .map((pendingIndex) => (pendingIndex > index ? pendingIndex - 1 : pendingIndex)));
    setNewFiles(previous => previous.filter((_, currentIndex) => currentIndex !== index));
    setNewFileAreas(previous => previous.filter((_, currentIndex) => currentIndex !== index));
    setNewFileLabels(previous => previous.filter((_, currentIndex) => currentIndex !== index));
    setNewFileMaterials(previous => previous.filter((_, currentIndex) => currentIndex !== index));
    setNewFileTerminations(previous => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSaveNewFileDetails = async (details) => {
    const index = detailsFileIndex;
    if (index === null) return;
    setNewFileLabels(previous => previous.map((label, currentIndex) => currentIndex === index ? details.publicLabel : label));
    setNewFileAreas(previous => previous.map((area, currentIndex) => currentIndex === index ? details.areaCode : area));
    setNewFileMaterials(previous => previous.map((materials, currentIndex) => currentIndex === index ? details.materialNames : materials));
    setNewFileTerminations(previous => previous.map((termination, currentIndex) => currentIndex === index ? details.terminationName : termination));
    setMissingLabelIndices([]);
    setMissingAreaIndices([]);
    setFieldErrors(previous => ({ ...previous, order_files: "" }));
    setPendingDetailsIndices(previous => previous.filter((pendingIndex) => pendingIndex !== index));
    setDetailsFileIndex(null);
    setDetailsExistingFileIndex(null);
  };

  const handleSaveExistingFileDetails = async (details) => {
    const index = detailsExistingFileIndex;
    if (index === null) return;
    setExistingFileRows((previous) => previous.map((file, currentIndex) => (
      currentIndex === index
        ? { ...file, public_label: details.publicLabel, production_area_code: details.areaCode, material_names: details.materialNames, termination_name: details.terminationName }
        : file
    )));
    setFieldErrors(previous => ({ ...previous, order_files: "" }));
    setDetailsExistingFileIndex(null);
    setDetailsFileIndex(null);
  };

  const handleRemoveExistingPreview = () => {
    if (!existingPreview) return;
    if (!canMutateStandaloneAsset) {
      setError("La Orden de Trabajo ya está en proceso y no puede eliminarse en esta etapa.");
      return;
    }
    void persistAssetRemoval({ urls: [existingPreview], nextPreview: null });
  };

  const handleAddNewPreview = (filesOrEvent) => {
    if (!canEditAssets) {
      setError(assetWorkflowMessage);
      return;
    }
    if (existingPreview && !canMutateStandaloneAsset) {
      setError("La Orden de Trabajo ya está en proceso y no puede reemplazarse en esta etapa.");
      return;
    }
    const file = Array.from(filesOrEvent?.target?.files || filesOrEvent || [])[0];
    if (!file) return;

    if (!REF_IMAGE_CONFIG.PREVIEW_ALLOWED_TYPES.includes(file.type)) {
      setFieldErrors(previous => ({ ...previous, design_preview: "Formato no soportado. Usa JPG, PNG, WebP, SVG o PDF." }));
      if (filesOrEvent?.target) filesOrEvent.target.value = "";
      return;
    }

    setFieldErrors(previous => ({ ...previous, design_preview: "" }));
    setNewPreview(file);
    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };

  const handleSubmit = async () => {
    if (isSellerEditBlocked) {
      setError(order?.status === "in_Quote"
        ? "No se puede editar una orden en cotización."
        : "No se puede editar una orden cancelada o entregada.");
      return;
    }

    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(errors.order_work || "Por favor, corrige los errores en el formulario.");
      requestAnimationFrame(() => {
        const element = document.querySelector(".ps-field-error");
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setLoading(true);
    setError("");
    setFieldErrors({});
    setMissingLabelIndices([]);
    setMissingAreaIndices([]);

    let fileUrls = [...existingFiles];
    const newFileUrls = [];
    const replacedFileUrls = [];

    try {
      for (const [rawIndex, replacement] of Object.entries(existingFileReplacements)) {
        const index = Number(rawIndex);
        if (!replacement || !existingFiles[index]) continue;
        if (!canMutateExistingAsset(existingFileRows[index])) {
          setLoading(false);
          setError("Uno de los archivos ya está en proceso y no puede reemplazarse en esta etapa.");
          return;
        }
        const fileName = buildStorageSafeFileName(replacement, `replacement-${index}-`);
        const publicUrl = await uploadOrderAsset({
          bucket: "order-docs",
          path: `orders/${order.id}/files/${fileName}`,
          file: replacement,
        });
        if (publicUrl) {
          replacedFileUrls.push({ oldUrl: existingFiles[index], newUrl: publicUrl, index });
          fileUrls[index] = publicUrl;
        }
      }
      for (let index = 0; index < newFiles.length; index += 1) {
        const file = newFiles[index];
        const fileName = buildStorageSafeFileName(file, `${index}-`);
        const publicUrl = await uploadOrderAsset({
          bucket: "order-docs",
          path: `orders/${order.id}/files/${fileName}`,
          file,
        });

        if (publicUrl) {
          fileUrls.push(publicUrl);
          newFileUrls.push(publicUrl);
        }
      }
    } catch (uploadError) {
      setLoading(false);
      setError(uploadError?.message || "Error al subir los archivos de diseño.");
      return;
    }

    const existingProductionRows = isSellerEdit ? existingFileRows.map((row, index) => ({
      order_id: order.id,
      url: replacedFileUrls.find((replacement) => replacement.index === index)?.newUrl || row.url,
      filename: existingFileReplacements[index]?.name || row.filename || parseFileName(row.url),
      public_label: row.public_label || null,
      production_area_code: row.production_area_code || null,
      material_names: row.material_names || [],
      termination_name: row.termination_name || null,
      status: row.status || "pending",
    })).filter((row) => (
      row.public_label
      && row.production_area_code
      && row.material_names.length > 0
      && row.termination_name
    )) : [];
    const productionRows = [
      ...existingProductionRows,
      ...(newFileUrls.length > 0
        ? buildProductionFileRows({
        orderId: order.id,
        urls: newFileUrls,
        files: newFiles,
        areaCodes: newFileAreas,
        publicLabels: newFileLabels,
        materialNames: newFileMaterials,
        terminationNames: newFileTerminations,
        userId: order.seller_id || order.created_by,
      })
        : []),
    ];

    let previewUrl = existingPreview;
    if (newPreview) {
      try {
        const fileName = buildStorageSafeFileName(newPreview, "preview-");
        previewUrl = await uploadOrderAsset({
          bucket: "order-previews",
          path: `orders/${order.id}/preview/${fileName}`,
          file: newPreview,
        });
      } catch (uploadError) {
        setLoading(false);
        setError(uploadError?.message || "Error al subir el preview de la orden.");
        return;
      }
    } else if (!existingPreview) {
      previewUrl = null;
    }

    let refImageUrls = [...existingRefImages];
    const newRefImageUrls = [];
    if (newRefImages.length > 0) {
      const totalCount = existingRefImages.length + newRefImages.length;
      if (totalCount > REF_IMAGE_CONFIG.MAX_COUNT) {
        setLoading(false);
        setError(`Solo se permiten hasta ${REF_IMAGE_CONFIG.MAX_COUNT} imagenes de referencia por orden.`);
        return;
      }
      const validation = validateReferenceImages(newRefImages);
      if (!validation.valid) {
        setLoading(false);
        setError(validation.errors.join(". "));
        return;
      }
      try {
        for (let index = 0; index < newRefImages.length; index += 1) {
          const file = await compressImage(newRefImages[index]);
          const fileName = buildStorageSafeFileName(file, `ref-${index}-`);
          const publicUrl = await uploadOrderAsset({
            bucket: "order-docs",
            path: `orders/${order.id}/ref-images/${fileName}`,
            file,
          });
          if (publicUrl) {
            refImageUrls.push(publicUrl);
            newRefImageUrls.push(publicUrl);
          }
        }
      } catch (uploadError) {
        setLoading(false);
        setError(uploadError?.message || "Error al subir las imagenes de referencia.");
        return;
      }
    }

    const assetChanges = {
      order_file_url: JSON.stringify(fileUrls),
      preview_image: previewUrl,
      reference_images: refImageUrls.length > 0 ? serializeReferenceImages(refImageUrls) : [],
    };
    const sellerChanges = assetsOnly
      ? assetChanges
      : {
        client_id: form.client_id,
        client_name: form.client_name.trim(),
        client_contact: form.client_contact.trim() || null,
        invoice_number: form.invoice_number.trim(),
        description: form.description.trim(),
        delivery_date: form.delivery_date || null,
        ...assetChanges,
      };
    if (lockClientIdentity) {
      delete sellerChanges.client_id;
      delete sellerChanges.client_name;
      delete sellerChanges.client_contact;
    }

    let updateError;
    let updatedOrder = null;
    try {
      if (isSellerEdit) {
        const { response, result } = await adminApiFetch("/api/seller-orders", {
          action: "update",
          order_id: order.id,
          expected_updated_at: assetVersion || order.updated_at,
          changes: sellerChanges,
          production_files: productionRows,
          removed_file_urls: [
            ...replacedFileUrls.map((replacement) => replacement.oldUrl),
            ...(existingPreview && newPreview ? [existingPreview] : []),
          ],
          asset_operation: assetsOnly ? "manage_assets" : undefined,
        });

        if (!response.ok) {
          throw new Error(result?.error || "No se pudo actualizar la orden.");
        }
        updatedOrder = result?.order || null;
      } else {
        const idempotencyKey = globalThis.crypto?.randomUUID?.()
          || `admin-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const adminChanges = {
          client_id: form.client_id,
          client_name: form.client_name.trim(),
          client_contact: form.client_contact.trim() || null,
          invoice_number: form.invoice_number.trim(),
          description: form.description.trim(),
          delivery_date: form.delivery_date || null,
        };
        if (canEditAssets) {
          adminChanges.preview_image = previewUrl;
          adminChanges.reference_images = refImageUrls.length > 0 ? serializeReferenceImages(refImageUrls) : [];
        }
        const { data: adminEditResult, error: adminEditError } = await supabase.rpc("admin_edit_order_with_file_specifications", {
          p_order_id: order.id,
          p_expected_updated_at: assetVersion || order.updated_at,
          p_changes: adminChanges,
          p_new_production_files: productionRows,
          p_removed_file_urls: existingPreview && newPreview ? [existingPreview] : [],
          p_idempotency_key: idempotencyKey,
        });
        if (adminEditError) {
          if (adminEditError.code === "PGRST202" || /could not find the function|schema cache/i.test(adminEditError.message || "")) {
            throw new Error("La configuración segura de edición aún no está aplicada. Aplica las migraciones pendientes antes de editar órdenes desde Administración.");
          }
          throw adminEditError;
        }
        if (!adminEditResult?.success || !adminEditResult?.order) {
          throw new Error("La edición administrativa no confirmó la actualización de la orden.");
        }
        updatedOrder = adminEditResult.order;
      }
    } catch (commandError) {
      updateError = commandError;
    }

    if (updateError) {
      setLoading(false);
      setError(`Error al actualizar: ${updateError.message}`);
      return;
    }

    const addedAssetCount = newFileUrls.length
      + replacedFileUrls.length
      + newRefImageUrls.length
      + (newPreview && previewUrl ? 1 : 0);

    setLoading(false);
    const parentUpdate = onUpdated?.(updatedOrder);
    if (assetsOnly && addedAssetCount > 0) {
      onAssetSaved?.({ order: updatedOrder, addedAssetCount });
    }
    await parentUpdate;
    if (assetsOnly && keepOpenAfterAssetSave) {
      // Keep the editor mounted for Semi-Administración: the parent has already
      // reconciled the confirmed order, while this local state is reset below.
      setExistingFiles(fileUrls);
      setExistingFileRows((previous) => previous.map((row, index) => ({
        ...row,
        url: fileUrls[index] || row.url,
        filename: existingFileReplacements[index]?.name || row.filename,
      })));
      setExistingFileReplacements({});
      setExistingPreview(previewUrl);
      setExistingRefImages(refImageUrls);
      setAssetVersion(updatedOrder?.updated_at || assetVersion);
      setNewFiles([]);
      setNewFileAreas([]);
      setNewFileLabels([]);
      setNewFileMaterials([]);
      setNewFileTerminations([]);
      setNewPreview(null);
      setNewRefImages([]);
      return;
    }
    onClose();
  };

  const parseFileName = (url) => {
    if (!url) return "Archivo";
    const parts = url.split("/");
    const fileName = parts[parts.length - 1];
    const nameParts = fileName.split("-");
    nameParts.shift();
    nameParts.shift();
    nameParts.shift();
    return nameParts.join("-") || fileName;
  };

  const selectedDetailsFile = detailsFileIndex === null ? null : newFiles[detailsFileIndex];
  const selectedExistingDetailsFile = detailsExistingFileIndex === null ? null : existingFileRows[detailsExistingFileIndex];

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={assetsOnly ? `Gestionar archivos #${order?.id?.slice(0, 8).toUpperCase()}` : `Editar Orden #${order?.id?.slice(0, 8).toUpperCase()}`}
      hideStripe={semiAdminVariant}
      className={semiAdminVariant ? "ps-edit-order-modal--semi-admin" : ""}
    >
      {error && <div className="ps-form-error">{error}</div>}

      {!assetsOnly && (
        <>
          <div className="ps-form-section-title">
            <span className="ps-form-section-num">1</span> Datos del cliente
          </div>
          <div className="ps-form-grid">
            <div className="col-full">
              <Field label="Cliente registrado" required error={fieldErrors.client_id} hint="Selecciona el cliente registrado de esta orden.">
                <ClientSelect
                  clients={clients}
                  loading={clientsLoading}
                  value={form.client_id}
                  onSelect={applySelectedClient}
                  onSearch={onClientSearch}
                  placeholder="Seleccionar cliente registrado"
                  disabled={lockClientIdentity}
                />
              </Field>
            </div>
            <div className="col-full">
              <Field label="Nombre del cliente" required error={fieldErrors.client_name}>
                <input className="ps-form-input" value={form.client_name} readOnly disabled />
              </Field>
            </div>
            <div className="col-full">
              <Field label="Contacto" required hint="Se completa desde el cliente registrado." error={fieldErrors.client_contact}>
                <input className="ps-form-input" placeholder={PHONE_PLACEHOLDER} value={form.client_contact} readOnly disabled maxLength="12" />
              </Field>
            </div>
          </div>

          <div className="ps-form-section-title" style={{ marginTop: 20 }}>
            <span className="ps-form-section-num">2</span> Detalles de la orden
          </div>
          <div className="ps-form-grid">
            <div className="col-full">
              <Field label="Descripcion" required error={fieldErrors.description}>
                <textarea className="ps-form-input textarea" value={form.description} onChange={event => set("description", event.target.value)} />
              </Field>
            </div>
            <div className="col-full">
              <Field label="Fecha de entrega" optional error={fieldErrors.delivery_date}>
                <div className="ps-input-icon-wrap">
                  <span className="ps-input-icon"><Icons.Calendar /></span>
                  <input className="ps-form-input with-icon" type="date" value={form.delivery_date} min={getMinimumDeliveryDate()} onChange={event => set("delivery_date", event.target.value)} />
                </div>
              </Field>
            </div>
          </div>
        </>
      )}

      {canEditAssets ? (
        <>
          <div className="ps-form-section-title" style={{ marginTop: 20 }}>
            <span className="ps-form-section-num">{assetsOnly ? <Icons.Paperclip /> : "3"}</span> Archivos y Orden de Trabajo
          </div>
          <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Archivos adjuntos" hint="Archivos de diseño existentes y nuevos" error={fieldErrors.order_files}>
            {existingFiles.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {existingFiles.map((url, index) => {
                  const row = existingFileRows[index] || { url };
                  const replacement = existingFileReplacements[index];
                  const displayName = replacement?.name || row.filename || parseFileName(url);
                  return (
                    <FileCard
                      key={`${url}-${index}`}
                      name={displayName}
                      url={url}
                      detailText={!canMutateExistingAsset(row) ? `${row.public_label || "Detalles pendientes"} · Archivo en proceso` : (row.public_label || "Detalles pendientes")}
                      actions={[
                        {
                          title: `Editar archivo y detalles de ${displayName}`,
                          label: "Editar detalles",
                          icon: <Icons.Edit />,
                          onClick: () => {
                            setDetailsExistingFileIndex(index);
                            setDetailsFileIndex(null);
                          },
                        },
                        ...(canMutateExistingAsset(row) ? [{
                          title: `Reemplazar ${displayName}`,
                          label: "Reemplazar",
                          icon: <Icons.Upload />,
                          onClick: () => {
                            setReplaceExistingFileIndex(index);
                            requestAnimationFrame(() => existingFileReplaceInputRef.current?.click());
                          },
                        }] : []),
                      ]}
                      onRemove={canMutateExistingAsset(row) ? () => handleRemoveExistingFile(url) : undefined}
                    />
                  );
                })}
                <input
                  ref={existingFileReplaceInputRef}
                  type="file"
                  className="sr-only"
                  accept=".pdf,.ai,.png,.jpg,.jpeg,.webp,.svg"
                  onChange={handleExistingFileReplaceInput}
                  aria-label="Seleccionar archivo de reemplazo"
                />
              </div>
            )}
            {newFiles.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {newFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className={missingLabelIndices.includes(index) || missingAreaIndices.includes(index) ? "ps-file-missing" : ""}>
                    <FileCard
                      name={file.name}
                      secondaryText={formatFileSize(file.size)}
                      detailText={newFileLabels[index] ? `Seguimiento: ${newFileLabels[index]}` : "Detalles pendientes"}
                      actions={[{
                        title: `Ver detalles de ${file.name}`,
                        label: "Detalles",
                        icon: <Icons.Edit />,
                        attention: pendingDetailsIndices.includes(index),
                        onClick: () => {
                          setPendingDetailsIndices(previous => previous.filter((pendingIndex) => pendingIndex !== index));
                          setDetailsFileIndex(index);
                        },
                      }]}
                      onRemove={() => handleRemoveNewFile(index)}
                    />
                  </div>
                ))}
              </div>
            )}
            <FileUploadZone
              mode="attachment"
              multiple
              inputRef={fileInputRef}
              buttonLabel="Agregar archivos"
              hint="PDF, AI, PNG, JPG..."
              onFilesAccepted={handleAddNewFiles}
            />
          </Field>
        </div>

        <div className="col-full">
          <Field label="Orden de Trabajo" required={requireWorkOrder} hint="Archivo obligatorio para continuar con la orden" error={fieldErrors.order_work}>
            {(existingPreview || newPreview) ? (
              <div className="ps-preview-showcase">
                <FileUploadZone
                  mode="image"
                  replaceMode
                  inputRef={previewInputRef}
                  className="file-upload-zone--hidden-picker"
                  buttonLabel="Cambiar Orden de Trabajo"
                  disabled={existingPreviewLocked}
                  onFilesAccepted={handleAddNewPreview}
                />
                {newPreview || resolvedExistingPreview ? <div className="ps-preview-card">
                  <img
                    src={newPreview ? URL.createObjectURL(newPreview) : resolvedExistingPreview}
                    alt="Orden de Trabajo"
                    className="ps-preview-img-main"
                  />
                  <div className="ps-preview-card-overlay">
                    <span className="ps-preview-card-label">
                      {newPreview ? "Nueva Orden de Trabajo" : "Orden de Trabajo actual"}
                    </span>
                    <div className="ps-preview-card-actions">
                      <button type="button" className="ps-preview-change-btn" disabled={existingPreviewLocked} title={existingPreviewLocked ? "La Orden de Trabajo está protegida mientras el archivo está en proceso." : undefined} onClick={() => previewInputRef.current?.click()}>
                        {newPreview ? "Cancelar" : "Cambiar"}
                      </button>
                      <button type="button" className="ps-preview-del-btn" disabled={existingPreviewLocked} title={existingPreviewLocked ? "La Orden de Trabajo no puede eliminarse en esta etapa." : "Eliminar Orden de Trabajo"} onClick={newPreview ? () => setNewPreview(null) : handleRemoveExistingPreview}>
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                </div> : <div className="ps-preview-resolution-state" role="status">{previewLoading ? "Cargando Orden de Trabajo…" : previewError}</div>}
              </div>
            ) : (
              <FileUploadZone
                mode="image"
                replaceMode
                inputRef={previewInputRef}
                buttonLabel="Subir Orden de Trabajo"
                hint="Adjunta la Orden de Trabajo (PNG, JPG, WebP...)"
                onFilesAccepted={handleAddNewPreview}
              />
            )}
          </Field>
        </div>

        <div className="col-full">
          <Field label="Imagenes de referencia" hint="Sube imagenes de referencia para la orden (opcional)">
            {existingRefImages.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {existingRefImages.map((url, index) => (
                  <div key={`${url}-${index}`} className="ps-file-item">
                    <SecureImage url={url} alt={parseFileName(url)} className="ps-ref-thumb" compact />
                    <span className="ps-file-name">{parseFileName(url)}</span>
                    <button className="ps-file-remove" disabled={!canMutateStandaloneAsset} title={!canMutateStandaloneAsset ? "Las imágenes de referencia existentes están protegidas en esta etapa." : "Eliminar imagen de referencia"} aria-label={!canMutateStandaloneAsset ? "Imagen de referencia protegida" : "Eliminar imagen de referencia"} onClick={() => {
                      if (!canEditAssets) {
                        setError(assetWorkflowMessage);
                        return;
                      }
                      if (!canMutateStandaloneAsset) {
                        setError("Las imágenes de referencia ya están en proceso y no pueden eliminarse en esta etapa.");
                        return;
                      }
                      void persistAssetRemoval({
                        urls: [url],
                        nextRefImages: existingRefImages.filter((_, currentIndex) => currentIndex !== index),
                      });
                    }}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {newRefImages.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {newRefImages.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="ps-file-item" style={{ borderColor: "var(--cyan)", background: "rgba(6, 182, 212, 0.04)" }}>
                    <img src={URL.createObjectURL(file)} alt={file.name} className="ps-ref-thumb" style={{ borderColor: "var(--cyan)" }} />
                    <span className="ps-file-name">{file.name}</span>
                    <button className="ps-file-remove" onClick={() => setNewRefImages(newRefImages.filter((_, currentIndex) => currentIndex !== index))}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <FileUploadZone
              mode="image"
              multiple
              inputRef={refImagesInputRef}
              maxFiles={REF_IMAGE_CONFIG.MAX_COUNT}
              existingCount={existingRefImages.length + newRefImages.length}
              buttonLabel="Subir imagenes"
              hint="Imagenes de referencia (Max 3, 20MB c/u. Soporta JPG, PNG, WebP, GIF, HEIC y HEIF)"
              onFilesAccepted={async (rawFiles, { showError }) => {
                if (!canEditAssets) {
                  setError(assetWorkflowMessage);
                  return;
                }
                const validFiles = [];
                const errors = [];
                for (const file of rawFiles) {
                  const result = await canDecodeAsImage(file);
                  if (result.valid) {
                    validFiles.push(file);
                  } else {
                    errors.push(`"${file.name}": ${result.error}`);
                  }
                }
                if (errors.length > 0) {
                  showError(errors.join(". "));
                }
                if (validFiles.length > 0) {
                  setNewRefImages([...newRefImages, ...validFiles]);
                }
              }}
            />
          </Field>
        </div>
          </div>
        </>
      ) : (
        <div className="ps-form-error" role="status">{assetWorkflowMessage}</div>
      )}

      <div className="ps-form-actions">
        <button className="ps-btn-cancel" onClick={onClose}>Cancelar</button>
        <button className="ps-btn-submit" onClick={handleSubmit} disabled={loading || assetRemovalLoading}>
          {loading ? "Guardando..." : assetsOnly ? "Guardar archivos ->" : "Guardar Cambios ->"}
        </button>
      </div>
    </Modal>
    <ProductionFileDetailsModal
      open={Boolean(selectedDetailsFile || selectedExistingDetailsFile)}
      fileName={selectedDetailsFile?.name || selectedExistingDetailsFile?.filename}
      fileKey={selectedDetailsFile ? `edit-new-${detailsFileIndex}-${selectedDetailsFile.name}` : selectedExistingDetailsFile ? `edit-existing-${detailsExistingFileIndex}-${selectedExistingDetailsFile.id}` : ""}
      value={selectedDetailsFile ? {
        publicLabel: newFileLabels[detailsFileIndex] || "",
        areaCode: newFileAreas[detailsFileIndex] || "",
        materialNames: newFileMaterials[detailsFileIndex] || [],
        terminationName: newFileTerminations[detailsFileIndex] || "",
      } : selectedExistingDetailsFile ? {
        publicLabel: selectedExistingDetailsFile.public_label || "",
        areaCode: selectedExistingDetailsFile.production_area_code || "",
        materialNames: selectedExistingDetailsFile.material_names || [],
        terminationName: selectedExistingDetailsFile.termination_name || "",
      } : null}
      catalog={productionCatalog}
      onClose={() => {
        setDetailsFileIndex(null);
        setDetailsExistingFileIndex(null);
      }}
      onSave={selectedDetailsFile ? handleSaveNewFileDetails : handleSaveExistingFileDetails}
      lockArea={Boolean(selectedExistingDetailsFile && isSemiAdminAssetEdit && !canMutateExistingAsset(selectedExistingDetailsFile))}
    />
    </>
  );
}
