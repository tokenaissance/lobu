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

export function SkillsRegistryTable() {
  return (
    <div>
      <h2>Bundled Skill Registry</h2>
      <p>
        Lobu no longer ships a bundled non-provider skill registry. Define local
        skills with <code>SKILL.md</code> files in your project.
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
              <th style={headerCellStyle}>Status</th>
              <th style={headerCellStyle}>How to define skills</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cellStyle}>Local only</td>
              <td style={cellStyle}>
                <code>skills/&lt;name&gt;/SKILL.md</code> or{" "}
                <code>agents/&lt;agent-id&gt;/skills/&lt;name&gt;/SKILL.md</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
