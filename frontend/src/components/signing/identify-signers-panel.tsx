"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  UI_ROLE_ADD_LABEL,
  UI_ROLE_HEADER_CLASS,
  UI_ROLE_LABEL,
  UI_ROLE_ORDER,
  NOTIFY_TYPE_OPTIONS,
  normalizeNotifyTypes,
  groupRecipientsByParty,
  newEmptyRecipient,
  normalizeUiRole,
  type CounterpartyKind,
  type SigningPartyBucket,
} from "@/lib/econtract-flow";
import type {
  EcontractNotifyType,
  EcontractSignType,
  EcontractUiRole,
  SignRecipient,
} from "@/lib/types";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";

const SIGN_TYPE_OPTIONS: { value: EcontractSignType; label: string }[] = [
  { value: "sign_img", label: "Ký ảnh" },
  { value: "sign_fca.passcode", label: "Ký số FPT.eSignCloud Passcode" },
  { value: "sign_ekyc", label: "Ký số eKYC / OTP" },
];

/** Placeholder — giữ party rỗng sống sót qua flatten ↔ group. */
const PARTY_SHELL_NAME = "__party_shell__";

type Props = {
  recipients: SignRecipient[];
  defaultBuyerOrgName: string;
  onChange: (next: SignRecipient[]) => void;
  readOnly?: boolean;
};

function ensureBuyerParty(
  parties: SigningPartyBucket[],
  defaultBuyerOrgName: string
): SigningPartyBucket[] {
  if (parties.some((p) => p.isMyOrg)) return parties;
  return [
    {
      partyId: "p_001",
      isMyOrg: true,
      orgName: defaultBuyerOrgName,
      partyKind: "organization" as const,
      order: 1,
      recipients: [],
    },
    ...parties,
  ];
}

function partiesFromRecipients(
  recipients: SignRecipient[],
  defaultBuyerOrgName: string
): SigningPartyBucket[] {
  const shells = recipients.filter((r) => r.name === PARTY_SHELL_NAME);
  const real = recipients.filter((r) => r.name !== PARTY_SHELL_NAME);
  const grouped = groupRecipientsByParty(real);

  for (const s of shells) {
    const pid = s.partyId || `p_${grouped.length + 1}`;
    if (grouped.some((p) => p.partyId === pid)) continue;
    grouped.push({
      partyId: pid,
      isMyOrg: s.isMyOrg ?? false,
      orgName: s.orgName || "",
      partyKind: s.isMyOrg
        ? "organization"
        : s.partyKind ?? null,
      order: s.order ?? grouped.length + 1,
      recipients: [],
    });
  }

  grouped.sort((a, b) => {
    if (a.isMyOrg !== b.isMyOrg) return a.isMyOrg ? -1 : 1;
    return a.order - b.order || a.partyId.localeCompare(b.partyId);
  });

  return ensureBuyerParty(grouped, defaultBuyerOrgName);
}

function flattenParties(parties: SigningPartyBucket[]): SignRecipient[] {
  const out: SignRecipient[] = [];
  for (const p of parties) {
    if (p.recipients.length === 0) {
      out.push({
        ...newEmptyRecipient(p, "signer", 1),
        name: PARTY_SHELL_NAME,
        email: "",
        partyId: p.partyId,
        orgName: p.orgName,
        isMyOrg: p.isMyOrg,
        partyKind: p.isMyOrg
          ? "organization"
          : p.partyKind || undefined,
        role: p.isMyOrg ? "company" : "counterparty",
      });
      continue;
    }
    for (const r of p.recipients) {
      out.push({
        ...r,
        partyId: p.partyId,
        orgName: p.orgName,
        isMyOrg: p.isMyOrg,
        partyKind: p.isMyOrg
          ? "organization"
          : p.partyKind || r.partyKind,
        role: p.isMyOrg ? "company" : "counterparty",
      });
    }
  }
  return out;
}

function nextPartyId(parties: SigningPartyBucket[]): string {
  let max = 0;
  for (const p of parties) {
    const m = /^p_(\d+)$/.exec(p.partyId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p_${String(max + 1).padStart(3, "0")}`;
}

export function IdentifySignersPanel({
  recipients,
  defaultBuyerOrgName,
  onChange,
  readOnly,
}: Props) {
  const [parties, setParties] = useState<SigningPartyBucket[]>(() =>
    partiesFromRecipients(recipients, defaultBuyerOrgName)
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const skipNextSync = useRef(false);

  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    setParties(partiesFromRecipients(recipients, defaultBuyerOrgName));
  }, [recipients, defaultBuyerOrgName]);

  const updateParties = (nextParties: SigningPartyBucket[]) => {
    skipNextSync.current = true;
    setParties(nextParties);
    onChange(flattenParties(nextParties));
  };

  const patchRecipient = (
    partyId: string,
    recipientId: string,
    patch: Partial<SignRecipient>
  ) => {
    updateParties(
      parties.map((p) => {
        if (p.partyId !== partyId) return p;
        return {
          ...p,
          recipients: p.recipients.map((r) =>
            r.id === recipientId ? { ...r, ...patch } : r
          ),
        };
      })
    );
  };

  const removeRecipient = (partyId: string, recipientId: string) => {
    updateParties(
      parties.map((p) => {
        if (p.partyId !== partyId) return p;
        return {
          ...p,
          recipients: p.recipients.filter((r) => r.id !== recipientId),
        };
      })
    );
  };

  const addRecipient = (partyId: string, role: EcontractUiRole) => {
    updateParties(
      parties.map((p) => {
        if (p.partyId !== partyId) return p;
        const seq = p.recipients.length + 1;
        return {
          ...p,
          recipients: [...p.recipients, newEmptyRecipient(p, role, seq)],
        };
      })
    );
  };

  const setOrgName = (partyId: string, orgName: string) => {
    updateParties(
      parties.map((p) => {
        if (p.partyId !== partyId) return p;
        return {
          ...p,
          orgName,
          recipients: p.recipients.map((r) => ({ ...r, orgName })),
        };
      })
    );
  };

  const setPartyKind = (partyId: string, partyKind: CounterpartyKind) => {
    updateParties(
      parties.map((p) => {
        if (p.partyId !== partyId) return p;
        return {
          ...p,
          partyKind,
          recipients: p.recipients.map((r) => ({ ...r, partyKind })),
        };
      })
    );
  };

  const visibleParties = parties.map((p) => ({
    ...p,
    recipients: p.recipients.filter((r) => r.name !== PARTY_SHELL_NAME),
  }));

  const buyer = useMemo(
    () => visibleParties.find((p) => p.isMyOrg) || null,
    [visibleParties]
  );
  const counterparties = useMemo(
    () => visibleParties.filter((p) => !p.isMyOrg),
    [visibleParties]
  );

  const addCounterparty = () => {
    const partyId = nextPartyId(parties);
    const party: SigningPartyBucket = {
      partyId,
      isMyOrg: false,
      orgName: "",
      partyKind: null, // bắt buộc chọn Tổ chức | Cá nhân
      order: parties.length + 1,
      recipients: [],
    };
    updateParties([...parties, party]);
  };

  const removeParty = (partyId: string) => {
    updateParties(parties.filter((p) => p.partyId !== partyId || p.isMyOrg));
  };

  const partyHandlers = {
    setOrgName,
    setPartyKind,
    addRecipient,
    patchRecipient,
    removeRecipient,
    removeParty,
    collapsed,
    setCollapsed,
    readOnly,
    defaultBuyerOrgName,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 h-full">
      {/* Trái — bên mua */}
      <div className="flex flex-col min-h-0 rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="shrink-0 border-b bg-sky-50 px-4 h-14 flex items-center">
          <h2 className="text-sm font-semibold text-sky-900">
            Bên mua · Tổ chức của tôi
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {buyer ? (
            <PartyCard
              party={buyer}
              counterpartIndex={null}
              {...partyHandlers}
            />
          ) : (
            <p className="text-sm text-muted-foreground p-2">
              Chưa có bên mua
            </p>
          )}
        </div>
      </div>

      {/* Phải — bên đối tác (nhiều bên) */}
      <div className="flex flex-col min-h-0 rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="shrink-0 border-b bg-amber-50 px-4 h-14 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-amber-950">Bên đối tác</h2>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 bg-white"
              onClick={addCounterparty}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Thêm bên ký
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {counterparties.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-12 px-4 text-center">
              <p className="text-sm text-muted-foreground">
                Chưa có bên đối tác. Thêm ít nhất một bên (Tổ chức hoặc Cá nhân).
              </p>
              {!readOnly && (
                <Button type="button" size="sm" onClick={addCounterparty}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Thêm bên ký
                </Button>
              )}
            </div>
          ) : (
            counterparties.map((party, idx) => (
              <PartyCard
                key={party.partyId}
                party={party}
                counterpartIndex={idx + 1}
                {...partyHandlers}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type PartyCardProps = {
  party: SigningPartyBucket;
  counterpartIndex: number | null;
  setOrgName: (partyId: string, orgName: string) => void;
  setPartyKind: (partyId: string, partyKind: CounterpartyKind) => void;
  addRecipient: (partyId: string, role: EcontractUiRole) => void;
  patchRecipient: (
    partyId: string,
    recipientId: string,
    patch: Partial<SignRecipient>
  ) => void;
  removeRecipient: (partyId: string, recipientId: string) => void;
  removeParty: (partyId: string) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  readOnly?: boolean;
  defaultBuyerOrgName: string;
};

function PartyCard({
  party,
  counterpartIndex,
  setOrgName,
  setPartyKind,
  addRecipient,
  patchRecipient,
  removeRecipient,
  removeParty,
  collapsed,
  setCollapsed,
  readOnly,
  defaultBuyerOrgName,
}: PartyCardProps) {
  const roles = UI_ROLE_ORDER.filter(
    (role) => !(party.isMyOrg && role === "coordinator")
  );
  const isIndividual = party.partyKind === "individual";
  const kindMissing =
    !party.isMyOrg &&
    party.partyKind !== "organization" &&
    party.partyKind !== "individual";

  return (
    <section className="rounded-md border overflow-hidden bg-white">
      <div className="flex flex-col gap-2 border-b px-3 py-2.5 bg-slate-50">
        <div className="flex flex-wrap items-center gap-2">
          {!party.isMyOrg && counterpartIndex != null && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-100 rounded px-1.5 py-0.5">
              Đối tác {counterpartIndex}
            </span>
          )}
          {!party.isMyOrg && (
            <div className="flex items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name={`party-kind-${party.partyId}`}
                  checked={party.partyKind === "organization"}
                  disabled={readOnly}
                  onChange={() => setPartyKind(party.partyId, "organization")}
                />
                Tổ chức
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name={`party-kind-${party.partyId}`}
                  checked={party.partyKind === "individual"}
                  disabled={readOnly}
                  onChange={() => setPartyKind(party.partyId, "individual")}
                />
                Cá nhân
              </label>
            </div>
          )}
          {!party.isMyOrg && !readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive shrink-0 ml-auto"
              onClick={() => removeParty(party.partyId)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Xóa bên
            </Button>
          )}
        </div>
        {kindMissing && (
          <p className="text-[11px] text-destructive">
            Bắt buộc chọn Tổ chức hoặc Cá nhân
          </p>
        )}
        <div className="min-w-[160px]">
          <div className="text-[11px] text-muted-foreground mb-0.5">
            {party.isMyOrg || !isIndividual ? "Tên tổ chức" : "Tên cá nhân"}
          </div>
          <Input
            value={party.orgName}
            readOnly={party.isMyOrg}
            disabled={readOnly || kindMissing || party.isMyOrg}
            onChange={(e) => setOrgName(party.partyId, e.target.value)}
            placeholder={
              party.isMyOrg
                ? defaultBuyerOrgName
                : isIndividual
                  ? "Nhập tên cá nhân"
                  : "Nhập tên tổ chức đối tác"
            }
            className={`h-9 font-medium ${isIndividual ? "" : "uppercase"} ${
              party.isMyOrg ? "bg-muted/50" : ""
            }`}
          />
        </div>
      </div>

      <div className="divide-y">
        {roles.map((role) => {
          const list = party.recipients.filter(
            (r) => normalizeUiRole(r.ecRole) === role
          );
          const key = `${party.partyId}_${role}`;
          const isOpen = collapsed[key] !== true;
          return (
            <div key={role}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-sm font-medium ${UI_ROLE_HEADER_CLASS[role]}`}
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [key]: isOpen }))
                }
              >
                <span>
                  {UI_ROLE_LABEL[role]} ({list.length})
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="p-2.5 space-y-2 bg-white">
                  {list.map((r) => (
                    <RecipientCard
                      key={r.id}
                      recipient={r}
                      role={role}
                      readOnly={readOnly}
                      onChange={(patch) =>
                        patchRecipient(party.partyId, r.id, patch)
                      }
                      onRemove={() => removeRecipient(party.partyId, r.id)}
                    />
                  ))}
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full border-dashed"
                      onClick={() => addRecipient(party.partyId, role)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {UI_ROLE_ADD_LABEL[role]}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecipientCard({
  recipient,
  role,
  readOnly,
  onChange,
  onRemove,
}: {
  recipient: SignRecipient;
  role: EcontractUiRole;
  readOnly?: boolean;
  onChange: (patch: Partial<SignRecipient>) => void;
  onRemove: () => void;
}) {
  const needsSignType = role === "signer" || role === "clerk";
  const notifyTypes = normalizeNotifyTypes(recipient.notifyTypes);

  return (
    <div className="rounded-md border p-2.5 space-y-2">
      <div className="flex flex-wrap gap-2 items-start">
        <div className="flex-1 min-w-[120px] space-y-1">
          <Label className="text-[11px]">Họ tên</Label>
          <Input
            value={recipient.name}
            disabled={readOnly}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Nhập họ tên"
            className="h-8"
          />
        </div>
        <div className="flex-1 min-w-[140px] space-y-1">
          <Label className="text-[11px]">Email</Label>
          <Input
            value={recipient.email || ""}
            disabled={readOnly}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="email@domain.com"
            className="h-8"
          />
          {!recipient.email?.includes("@") && (
            <p className="text-[11px] text-destructive">
              Trường này bắt buộc phải nhập
            </p>
          )}
        </div>
        <div className="w-28 space-y-1">
          <Label className="text-[11px]">SĐT</Label>
          <Input
            value={recipient.phone || ""}
            disabled={readOnly}
            onChange={(e) => onChange({ phone: e.target.value })}
            className="h-8"
          />
        </div>
        <div className="w-32 space-y-1">
          <Label className="text-[11px]">Mã LH (contactId)</Label>
          <Input
            value={recipient.contactId || ""}
            disabled={readOnly}
            onChange={(e) => onChange({ contactId: e.target.value })}
            placeholder="Tự sinh nếu trống"
            className="h-8"
          />
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-5 text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <NotifyTypesMultiSelect
        value={notifyTypes}
        disabled={readOnly}
        onChange={(next) => onChange({ notifyTypes: next })}
      />

      {needsSignType && (
        <div className="space-y-1">
          <Label className="text-[11px]">Hình thức ký</Label>
          <select
            className="h-8 w-full rounded-md border px-2 text-sm"
            disabled={readOnly}
            value={recipient.signType || "sign_fca.passcode"}
            onChange={(e) =>
              onChange({
                signType: e.target.value as EcontractSignType,
              })
            }
          >
            {SIGN_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function NotifyTypesMultiSelect({
  value,
  disabled,
  onChange,
}: {
  value: EcontractNotifyType[];
  disabled?: boolean;
  onChange: (next: EcontractNotifyType[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (v: EcontractNotifyType) => {
    if (disabled) return;
    if (value.includes(v)) {
      const next = value.filter((x) => x !== v);
      // Không cho bỏ hết — giữ ít nhất 1 kênh
      onChange(next.length ? next : value);
    } else {
      onChange([...value, v]);
    }
  };

  const remove = (v: EcontractNotifyType) => {
    if (disabled) return;
    const next = value.filter((x) => x !== v);
    if (next.length) onChange(next);
  };

  return (
    <div className="space-y-1" ref={rootRef}>
      <Label className="text-[11px]">Hình thức gửi thông báo</Label>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50/80 px-2 py-1.5 text-left text-sm disabled:opacity-60"
        >
          {value.map((v) => {
            const label =
              NOTIFY_TYPE_OPTIONS.find((o) => o.value === v)?.label || v;
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-950"
              >
                {label}
                {!disabled && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="rounded p-0.5 hover:bg-sky-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        remove(v);
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </span>
            );
          })}
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
        {open && !disabled && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-sky-200 bg-sky-50 shadow-md">
            {NOTIFY_TYPE_OPTIONS.map((o) => {
              const selected = value.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-sky-100 ${
                    selected ? "bg-sky-100/80 font-medium" : ""
                  }`}
                  onClick={() => toggle(o.value)}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
