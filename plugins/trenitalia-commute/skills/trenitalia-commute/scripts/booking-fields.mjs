export async function fillRequiredField(page, selector, expected, label) {
  const field = page.locator(selector).filter({ visible: true }).first();
  if (!(await field.count())) throw new Error(`${label} field is missing`);
  if ((await field.inputValue()) !== expected) await field.fill(expected);
  if ((await field.inputValue()) !== expected) throw new Error(`${label} field did not retain the configured value`);
}
