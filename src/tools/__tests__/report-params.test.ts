import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getClient = vi.fn();
vi.mock("../../deps.js", () => ({
  clientManager: { getClient: (id: string) => getClient(id) },
  connectionStore: {},
  oauthStore: {},
  intuitOAuth: {},
  oauthProvider: {},
}));

const { registerReportTools } = await import("../reports.js");
const { MAX_ROWS_CEILING, asRecord } = await import("../_format.js");

const REPORT = {
  Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Amount" }] },
  Rows: { Row: [{ ColData: [{ value: "Software" }, { value: "10.00" }] }] },
};

const reportCall = vi.fn(
  (_p: object, cb: (e: unknown, d: unknown) => void) => cb(null, REPORT),
);

let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerReportTools(server, "conn-1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  reportCall.mockClear();
  getClient.mockReset();
  getClient.mockResolvedValue({
    qb: {
      reportGeneralLedgerDetail: reportCall,
      reportTransactionList: reportCall,
    },
    realmId: "793988035",
  });
});

describe("report tool parameters, as a client sees them", () => {
  it("rejects a max_rows above the ceiling before anything reaches QuickBooks", async () => {
    const result = await client.callTool({
      name: "get_general_ledger",
      arguments: { max_rows: MAX_ROWS_CEILING + 1 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/max_rows/);
    expect(reportCall).not.toHaveBeenCalled();
  });

  it("accepts a max_rows at the ceiling", async () => {
    const result = await client.callTool({
      name: "get_general_ledger",
      arguments: { max_rows: MAX_ROWS_CEILING },
    });
    expect(result.isError).toBeFalsy();
    expect(reportCall).toHaveBeenCalledTimes(1);
  });

  it("never describes a parameter a tool does not accept", async () => {
    // A description that names a filter the schema lacks sends the model down
    // a path where its argument is silently dropped and the report quietly
    // covers the wrong population. Every backticked identifier a description
    // uses must be a real parameter of that tool, or the name of a tool.
    const { tools } = await client.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));
    const identifier = /`([a-z][a-z0-9_]*)`/g;

    for (const tool of tools) {
      const properties = asRecord(tool.inputSchema.properties) ?? {};
      const params = new Set(Object.keys(properties));
      const texts = [tool.description ?? ""];
      for (const schema of Object.values(properties)) {
        const description = asRecord(schema)?.description;
        if (typeof description === "string") texts.push(description);
      }
      for (const text of texts) {
        for (const match of text.matchAll(identifier)) {
          const name = match[1]!;
          expect(
            params.has(name) || toolNames.has(name),
            `${tool.name} describes \`${name}\`, which is neither one of its parameters nor a tool`,
          ).toBe(true);
        }
      }
    }
  });
});
