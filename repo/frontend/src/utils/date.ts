const mmDdYyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const isValidDateParts = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const parseMmDdYyyy = (value: string) => {
  if (!value) {
    return "";
  }

  const match = value.match(mmDdYyyy);
  if (!match) {
    return "";
  }

  const [, month, day, year] = match;
  if (!isValidDateParts(Number(year), Number(month), Number(day))) {
    return "";
  }

  return `${year}-${month}-${day}`;
};

export const formatIsoToMmDdYyyy = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
};
