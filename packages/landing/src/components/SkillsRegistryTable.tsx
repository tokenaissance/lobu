const cellStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--color-page-border)",
  fontSize: "13px",
  color: "var(--color-page-text-muted)",
};

const headerCellStyle = {
  ...cellStyle,
  fontWeight: 600,
  color: "var(--color-page-text)",
  backgroundColor: "var(--color-page-surface-dim)",
};

const starterSkills = [
  {
    product: "Lobu",
    install: "npx skills add lobu-ai/lobu --skill lobu --agent openclaw -y",
    adds: "Copies the public Lobu skill into skills/lobu/ for Lobu/OpenClaw",
  },
  {
    product: "Owletto",
    install: "npx skills add lobu-ai/lobu --skill owletto --agent openclaw -y",
    adds: "Copies the public Owletto skill into skills/owletto/",
  },
  {
    product: "Owletto",
    install: "npx skills add lobu-ai/lobu --skill owletto-openclaw --agent openclaw -y",
    adds: "Copies the OpenClaw-specific Owletto skill into skills/owletto-openclaw/",
  },
];

export function SkillsRegistryTable() {
  return (
    <div>
      <h2>Public Skills</h2>
      <p>
        Lobu and Owletto publish separate public skills through <code>npx skills</code>.
        In Lobu projects, <code>--agent openclaw -y</code> materializes the
        repo-local <code>skills/</code> directory that Lobu discovers automatically.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid var(--color-page-border)",
          }}
        >
          <thead>
            <tr>
              <th style={headerCellStyle}>Product</th>
              <th style={headerCellStyle}>Install command</th>
              <th style={headerCellStyle}>What it adds</th>
            </tr>
          </thead>
          <tbody>
            {starterSkills.map((skill) => (
              <tr key={skill.install}>
                <td style={cellStyle}>{skill.product}</td>
                <td style={cellStyle}>
                  <code>{skill.install}</code>
                </td>
                <td style={cellStyle}>{skill.adds}</td>
              </tr>
            ))}
            <tr>
              <td style={cellStyle}>Local skill</td>
              <td style={cellStyle}>
                <code>skills/&lt;name&gt;/SKILL.md</code> or{" "}
                <code>
                  agents/&lt;agent-id&gt;/skills/&lt;name&gt;/SKILL.md
                </code>
              </td>
              <td style={cellStyle}>
                A project-owned custom skill discovered automatically
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
