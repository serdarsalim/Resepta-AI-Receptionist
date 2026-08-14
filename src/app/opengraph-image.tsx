import { ImageResponse } from "next/og";

export const alt =
  "Resepta connects an incoming call to an appointment and customer confirmation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background:
            "radial-gradient(circle at 14% 8%, rgba(16,185,129,.20), transparent 36%), radial-gradient(circle at 92% 88%, rgba(59,130,246,.18), transparent 38%), #090909",
          color: "#f5f5f5",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: "64px 70px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 610 }}>
          <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
            <div
              style={{
                alignItems: "center",
                background: "#f43f5e",
                borderRadius: 12,
                display: "flex",
                fontSize: 27,
                fontWeight: 700,
                height: 46,
                justifyContent: "center",
                width: 46,
              }}
            >
              »
            </div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>Resepta</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 65,
              fontWeight: 750,
              letterSpacing: "-3.6px",
              lineHeight: 0.98,
              marginTop: 74,
            }}
          >
            <span>The call becomes</span>
            <span>a booking.</span>
            <span style={{ color: "#34d399" }}>The follow-up</span>
            <span style={{ color: "#60a5fa" }}>is already moving.</span>
          </div>

          <div
            style={{
              color: "#b7b7b7",
              display: "flex",
              fontSize: 24,
              lineHeight: 1.4,
              marginTop: 34,
              width: 560,
            }}
          >
            Calls, customers, appointments and follow-up in one connected front desk.
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(145deg, rgba(16,185,129,.18), rgba(59,130,246,.12))",
            borderRadius: 30,
            display: "flex",
            padding: 12,
            transform: "rotate(1deg)",
            width: 405,
          }}
        >
          <div
            style={{
              background: "#151515",
              borderRadius: 22,
              display: "flex",
              flexDirection: "column",
              padding: 22,
              width: "100%",
            }}
          >
            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>Live workflow</span>
              <span style={{ color: "#34d399", fontSize: 14 }}>● Connected</span>
            </div>

            <FlowCard color="#60a5fa" label="Incoming call" title="Olivia Reed">
              Thursday afternoon, first visit
            </FlowCard>
            <FlowArrow />
            <FlowCard color="#34d399" label="Appointment created" title="Thursday · 14:30">
              First visit · 45 min
            </FlowCard>
            <FlowArrow />
            <FlowCard color="#34d399" label="Confirmation delivered" title="Olivia confirmed">
              Reminder time scheduled
            </FlowCard>
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function FlowCard({
  children,
  color,
  label,
  title,
}: {
  children: React.ReactNode;
  color: string;
  label: string;
  title: string;
}) {
  return (
    <div
      style={{
        background: "#202020",
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        marginTop: 16,
        padding: "17px 18px",
      }}
    >
      <div style={{ color, display: "flex", fontSize: 14, fontWeight: 700 }}>{label}</div>
      <div style={{ display: "flex", fontSize: 20, fontWeight: 700, marginTop: 9 }}>{title}</div>
      <div style={{ color: "#a3a3a3", display: "flex", fontSize: 15, marginTop: 5 }}>{children}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div style={{ color: "#737373", display: "flex", fontSize: 17, height: 9, justifyContent: "center" }}>
      ↓
    </div>
  );
}
