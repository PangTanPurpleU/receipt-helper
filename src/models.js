export const LOCAL_MODELS = [
  {
    id: "paddle-v6-tiny",
    prefix: "PP-OCRv6_tiny",
    label: "v6 tiny",
    description: "免费本地识别 · 照片不上传。",
  },
];
export function localModel(id) {
  const model = LOCAL_MODELS.find((m) => m.id === id);
  if (!model) throw new Error("不支持的本地识别模型");
  return model;
}
