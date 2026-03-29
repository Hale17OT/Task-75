const mmDdYyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const parseMmDdYyyy = (value: string) => {
  if (!value) {
    return "";
  }

  const match = value.match(mmDdYyyy);
  if (!match) {
    return "";
  }

  const [, month, day, year] = match;
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
