export const LOCAL_MODELS=[
 {id:'paddle-v5',prefix:'PP-OCRv5_mobile',label:'v5 mobile · 当前稳定版',description:'保留当前已验证的识别效果。'},
 {id:'paddle-v6',prefix:'PP-OCRv6_small',label:'v6 small · 精度试用',description:'本次虚构凭证测试字段更完整，首次使用请与原图核对。'},
 {id:'paddle-v6-tiny',prefix:'PP-OCRv6_tiny',label:'v6 tiny · 快速试用',description:'本次虚构凭证测试更快，首次使用请核对金额和长单号。'},
];
export function localModel(id){const model=LOCAL_MODELS.find(m=>m.id===id);if(!model)throw new Error('不支持的本地识别模型');return model;}
