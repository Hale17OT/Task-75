export const hammingSimilarity = (left: string, right: string) => {
  const maxLength = Math.max(left.length, right.length);
  let distance = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }

  return 1 - distance / maxLength;
};
