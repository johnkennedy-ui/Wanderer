const Services = {
  get(_name: string): unknown {
    return undefined;
  },
};
Services.get("session");

const registerFeature = (): void => undefined;
registerFeature();

export const directStorage = window.localStorage.getItem(
  "wanderer.save.primary",
);
export const directDom = document.createElement("div");
