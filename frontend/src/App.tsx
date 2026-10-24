import {
  ContentSwitcher, DatePicker, DatePickerInput, Dropdown, Header, HeaderGlobalAction, HeaderGlobalBar,
  HeaderMenuButton, HeaderMenuItem, HeaderName, HeaderNavigation, HeaderSideNavItems, IconButton, SideNav,
  SideNavItems, Switch, Theme, Toggle,
} from "@carbon/react";
import { Asleep, ChevronLeft, ChevronRight, Light } from "@carbon/icons-react";
import { useEffect, useState } from "react";
import { api, type Meta, type Provenance } from "./api";
import AccuracyView from "./components/AccuracyView";
import DecisionView from "./components/DecisionView";
import { CONFIDENCES } from "./components/PlanPanel";
import { ErrorState, Loading } from "./components/ui";
import { fmtDate, shiftDate } from "./format";
import { setTheme, useTheme } from "./theme";
import { readParam, writeParam } from "./url";

// GB day-ahead auction gate closures (UK time).
const GATES: Record<string, string> = { "09:20": "EPEX gate", "09:50": "N2EX gate" };
const cutoffLabel = (o: string | null | undefined) => (o ? `${o}${GATES[o] ? ` (${GATES[o]})` : ""}` : "");

type Tab = "decision" | "accuracy";

/** "2026-01-28" -> "28/01/2026", the DatePicker's dateFormat (it takes min/max as strings in that format). */
const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** "2026-01-28" -> "Wed 28 Jan 2026". */
const fmtLongDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  return `${part({ weekday: "short" })} ${part({ day: "numeric" })} ${part({ month: "short" })} ${part({ year: "numeric" })}`;
};

/** ISO date (YYYY-MM-DD) of a local Date, without a UTC shift. */
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function initialConfidence() {
  const c = Number(readParam("confidence"));
  return CONFIDENCES.includes(c) ? c : 80;
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(readParam("view") === "accuracy" ? "accuracy" : "decision");
  const [cutoff, setCutoff] = useState("09:20");
  const [date, setDate] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(initialConfidence);
  // Off by default so the view shows only what was known at decision time; ?actual=1 turns it on.
  const [showActual, setShowActual] = useState(() => readParam("actual") === "1");
  const [prov, setProv] = useState<Provenance | null>(null);
  const theme = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const go = (t: Tab) => (e: React.MouseEvent) => { e.preventDefault(); setTab(t); setNavOpen(false); };
  const navItems = (["decision", "accuracy"] as Tab[]).map((t) => (
    <HeaderMenuItem key={t} href="#" isActive={tab === t} aria-current={tab === t ? "page" : undefined} onClick={go(t)}>
      {t === "decision" ? "Decision" : "Accuracy"}
    </HeaderMenuItem>
  ));

  useEffect(() => {
    api.meta().then((m) => {
      const c = readParam("cutoff");
      setCutoff(c && m.cutoffOptions.includes(c) ? c : m.defaultCutoff);
      const d = readParam("date");
      setDate(d && d >= m.firstDelivery && d <= m.lastDelivery ? d : m.representativeDelivery);
      setMeta(m);
    }).catch((e) => setError(String(e)));
    api.provenance().then(setProv).catch(() => setProv(null));
  }, []);
  useEffect(() => { if (meta) writeParam("cutoff", cutoff); }, [meta, cutoff]);
  useEffect(() => { if (date) writeParam("date", date); }, [date]);
  useEffect(() => { writeParam("confidence", String(confidence)); }, [confidence]);
  useEffect(() => { writeParam("actual", showActual ? "1" : null); }, [showActual]);
  useEffect(() => { writeParam("view", tab === "accuracy" ? "accuracy" : null); }, [tab]);

  return (
    <Theme theme={theme === "dark" ? "g100" : "g10"} className="app-theme">
      <Header aria-label="Wind Forecast Desk">
        {/* Below Carbon's large breakpoint the header navigation hides; the menu button opens the same items. */}
        <HeaderMenuButton aria-label={navOpen ? "Close menu" : "Open menu"} isActive={navOpen}
          onClick={() => setNavOpen(!navOpen)} />
        <HeaderName href="#" prefix="">Wind Forecast Desk</HeaderName>
        <HeaderNavigation aria-label="Views">{navItems}</HeaderNavigation>
        <SideNav aria-label="Views menu" expanded={navOpen} isPersistent={false} onOverlayClick={() => setNavOpen(false)}>
          <SideNavItems><HeaderSideNavItems>{navItems}</HeaderSideNavItems></SideNavItems>
        </SideNav>
        <HeaderGlobalBar>
          <HeaderGlobalAction aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} tooltipAlignment="end"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Light size={20} /> : <Asleep size={20} />}
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>

      {meta && date && (
        <section className="control-bar" aria-label="View controls">
          <div className="page-title">
            {tab === "decision"
              ? <h1>Day-ahead plan · {fmtLongDate(date)}</h1>
              : <><h1>Forecast performance · January 2026</h1><p>Delivery days {fmtDate(meta.firstDelivery)} – {fmtDate(meta.lastDelivery)}</p></>}
          </div>
          {tab === "decision" && (
            <div className="date-group">
              <IconButton kind="ghost" size="md" label="Previous day" disabled={date <= meta.firstDelivery}
                onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft /></IconButton>
              {/* value as a date-only string: a Date at 12:00 on the last day is later than maxDate (00:00) and flatpickr drops it */}
              <DatePicker datePickerType="single" dateFormat="d/m/Y" value={dmy(date)}
                minDate={dmy(meta.firstDelivery)} maxDate={dmy(meta.lastDelivery)}
                onChange={(dates: Date[]) => { if (dates[0]) setDate(isoLocal(dates[0])); }}>
                <DatePickerInput id="delivery-day" labelText="Delivery day" placeholder="dd/mm/yyyy" size="md" />
              </DatePicker>
              <IconButton kind="ghost" size="md" label="Next day" disabled={date >= meta.lastDelivery}
                onClick={() => setDate(shiftDate(date, 1))}><ChevronRight /></IconButton>
            </div>
          )}
          <div style={{ width: 200 }}>
            <Dropdown id="cutoff" titleText="Decision time (D-1, UK)" label="Decision time" size="md"
              items={meta.cutoffOptions} itemToString={cutoffLabel} selectedItem={cutoff}
              onChange={({ selectedItem }: { selectedItem: string | null }) => selectedItem && setCutoff(selectedItem)} />
          </div>
          {tab === "decision" && (
            <>
              <div>
                <div className="cds--label" id="confidence-label">Exceedance level</div>
                <ContentSwitcher size="md" aria-labelledby="confidence-label" selectedIndex={CONFIDENCES.indexOf(confidence)}
                  onChange={({ index }) => index != null && setConfidence(CONFIDENCES[index])}>
                  {CONFIDENCES.map((c) => <Switch key={c} name={String(c)} text={`P${c}`} />)}
                </ContentSwitcher>
              </div>
              <div className="toggle-field">
                <div className="cds--label" aria-hidden="true">Show outturn</div>
                <Toggle id="show-actual" size="sm" labelText="Show outturn" labelA="" labelB=""
                toggled={showActual} onToggle={(v: boolean) => setShowActual(v)} />
              </div>
            </>
          )}
        </section>
      )}

      <main className="page" style={meta ? undefined : { marginTop: 48 }}>
        {error && <ErrorState error={error} />}
        {!meta && !error && <Loading height={400} />}
        {meta && date && (tab === "decision"
          ? <DecisionView meta={meta} cutoff={cutoff} date={date} confidence={confidence} showActual={showActual} />
          : <AccuracyView cutoff={cutoff} />)}

        <footer className="provenance" aria-label="Data source">
          Source: Elexon BMRS (WINDFOR, FUELHH).
          {prov && <> Snapshot {new Date(prov.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, {prov.allVerified
            ? "checksums verified."
            : <span className="bad">checksum mismatch in {prov.files.filter((f) => !f.verified).map((f) => f.file).join(", ")}.</span>}</>}
          {" "}UK local time.
        </footer>
      </main>
    </Theme>
  );
}
