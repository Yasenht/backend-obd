export interface ParsedObdResponse {
  type: string;
  success: boolean;
  status: string;

  values: Record<string, unknown>;

  dtcs: string[];

  problem?: string;
}

export class ObdParser {
  static parse(
    command: string,
    response: string,
  ): ParsedObdResponse {
    const cmd = command
      .replace(/[\r\n]/g, "")
      .trim()
      .toUpperCase();

    const raw = response
      .replace(/\r/g, "\n")
      .trim();

    if (!raw) {
      return {
        type: "empty",
        success: false,
        status: "no_response",
        values: {},
        dtcs: [],
        problem: "لم يصل أي رد من جهاز OBD.",
      };
    }

    const upper = raw.toUpperCase();

    if (
      upper.includes("NO DATA") ||
      upper.includes("NODATA")
    ) {
      return {
        type: "elm_error",
        success: false,
        status: "no_data",
        values: {},
        dtcs: [],
        problem: "لم تحصل وحدة OBD على استجابة من السيارة.",
      };
    }

    if (
      upper.includes("BUS INIT") &&
      upper.includes("ERROR")
    ) {
      return {
        type: "elm_error",
        success: false,
        status: "bus_init_error",
        values: {},
        dtcs: [],
        problem: "فشل تهيئة ناقل الاتصال مع السيارة.",
      };
    }

    if (
      upper.includes("UNABLE TO CONNECT")
    ) {
      return {
        type: "elm_error",
        success: false,
        status: "unable_to_connect",
        values: {},
        dtcs: [],
        problem: "تعذر الاتصال بوحدة التحكم ECU.",
      };
    }

    if (upper.includes("ERROR")) {
      return {
        type: "elm_error",
        success: false,
        status: "error",
        values: {},
        dtcs: [],
        problem: raw,
      };
    }

    const bytes = extractHexBytes(raw);

    if (cmd == "010C") {
      return parseRpm(bytes);
    }

    if (cmd == "010D") {
      return parseSpeed(bytes);
    }

    if (cmd == "0105") {
      return parseCoolant(bytes);
    }

    if (cmd == "0111") {
      return parseThrottle(bytes);
    }

    if (cmd == "0104") {
      return parseEngineLoad(bytes);
    }

    if (cmd == "010B") {
      return parseMap(bytes);
    }

    if (cmd == "010F") {
      return parseIntakeAir(bytes);
    }

    if (cmd == "0110") {
      return parseMaf(bytes);
    }

    if (
      cmd == "03" ||
      cmd == "07" ||
      cmd == "0A"
    ) {
      return parseDtc(bytes);
    }

    return {
      type: "unknown",
      success: true,
      status: "response_received",
      values: {
        rawHex: bytes,
      },
      dtcs: [],
    };
  }
}

function extractHexBytes(
  response: string,
): number[] {
  const matches = response.match(/\b[0-9A-Fa-f]{2}\b/g);

  if (!matches) {
    return [];
  }

  return matches.map((value) => parseInt(value, 16));
}

function getPidData(
  bytes: number[],
  pid: number,
): number[] | null {
  for (
    let i = 0;
    i < bytes.length - 1;
    i++
  ) {
    if (
      bytes[i] === 0x41 &&
      bytes[i + 1] === pid
    ) {
      return bytes.slice(i + 2);
    }
  }

  return null;
}

function parseRpm(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x0c);

  if (!data || data.length < 2) {
    return {
      type: "rpm",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
      problem: "رد RPM غير مكتمل.",
    };
  }

  const rpm = ((data[0] * 256) + data[1]) / 4;

  return {
    type: "rpm",
    success: true,
    status: "ok",
    values: {
      rpm,
      unit: "rpm",
    },
    dtcs: [],
  };
}

function parseSpeed(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x0d);

  if (!data || data.length < 1) {
    return {
      type: "speed",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  return {
    type: "speed",
    success: true,
    status: "ok",
    values: {
      speed: data[0],
      unit: "km/h",
    },
    dtcs: [],
  };
}

function parseCoolant(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x05);

  if (!data || data.length < 1) {
    return {
      type: "coolant_temperature",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  return {
    type: "coolant_temperature",
    success: true,
    status: "ok",
    values: {
      temperature: data[0] - 40,
      unit: "C",
    },
    dtcs: [],
  };
}

function parseThrottle(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x11);

  if (!data || data.length < 1) {
    return {
      type: "throttle",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  return {
    type: "throttle",
    success: true,
    status: "ok",
    values: {
      percentage: (data[0] * 100) / 255,
      unit: "%",
    },
    dtcs: [],
  };
}

function parseEngineLoad(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x04);

  if (!data || data.length < 1) {
    return {
      type: "engine_load",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  return {
    type: "engine_load",
    success: true,
    status: "ok",
    values: {
      percentage: (data[0] * 100) / 255,
      unit: "%",
    },
    dtcs: [],
  };
}

function parseMap(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x0b);

  if (!data || data.length < 1) {
    return {
      type: "map",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  return {
    type: "map",
    success: true,
    status: "ok",
    values: {
      pressure: data[0],
      unit: "kPa",
    },
    dtcs: [],
  };
}

function parseIntakeAir(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x0f);

  if (!data || data.length < 1) {
    return {
      type: "intake_air_temperature",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  return {
    type: "intake_air_temperature",
    success: true,
    status: "ok",
    values: {
      temperature: data[0] - 40,
      unit: "C",
    },
    dtcs: [],
  };
}

function parseMaf(
  bytes: number[],
): ParsedObdResponse {
  const data = getPidData(bytes, 0x10);

  if (!data || data.length < 2) {
    return {
      type: "maf",
      success: false,
      status: "invalid_response",
      values: {},
      dtcs: [],
    };
  }

  const maf = ((data[0] * 256) + data[1]) / 100;

  return {
    type: "maf",
    success: true,
    status: "ok",
    values: {
      maf,
      unit: "g/s",
    },
    dtcs: [],
  };
}

function parseDtc(
  bytes: number[],
): ParsedObdResponse {
  const dtcs: string[] = [];

  for (
    let i = 0;
    i + 1 < bytes.length;
    i += 2
  ) {
    const a = bytes[i];
    const b = bytes[i + 1];

    if (a === 0 && b === 0) {
      continue;
    }

    const type = (a >> 6) & 0x03;

    const letters = [
      "P",
      "C",
      "B",
      "U",
    ];

    const code = letters[type] +
      ((a >> 4) & 0x03) +
      (a & 0x0f).toString(16).toUpperCase() +
      (b >> 4).toString(16).toUpperCase() +
      (b & 0x0f).toString(16).toUpperCase();

    dtcs.push(code);
  }

  return {
    type: "dtc",
    success: true,
    status: dtcs.length ? "dtcs_found" : "no_dtcs",
    values: {},
    dtcs,
  };
}
