import { ObdParser } from "@Jobs/ObdParser.ts";

Deno.test("parses mode-03 DTC payload without treating its response byte as a code", () => {
  const Result = ObdParser.parse("03", "43 03 01 00 00");

  if (JSON.stringify(Result.dtcs) !== JSON.stringify(["P0301"])) {
    throw new Error(`Expected P0301 only, got ${JSON.stringify(Result.dtcs)}`);
  }
});

Deno.test("rejects a DTC response that has no OBD response header", () => {
  const Result = ObdParser.parse("03", "03 01 00");

  if (Result.success || Result.status !== "invalid_response") {
    throw new Error("Expected an invalid DTC response.");
  }
});
