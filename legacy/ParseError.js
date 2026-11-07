class ParseError extends Error {
  constructor(message) {
    super();
    this.name = "ParseError"
    this.message = message || "Can't parse disctionary. Wrong DSL data.";
    Error.captureStackTrace(this, ParseError);
  }
}

module.exports = ParseError;