/**
 * Adaptador temporário para compatibilidade entre sistema antigo e novo
 */
export function adaptConfig(config: any) {
  // Se já tem a estrutura nova (providers), criar compatibilidade com estrutura antiga (models)
  if (config.llm?.providers && !config.llm?.models) {
    const providers = config.llm.providers;
    
    // Criar estrutura models básica baseada nos providers configurados
    const models: any = {};
    
    // Extrair providers únicos dos modelos configurados
    const allModels = [
      providers.premium?.model,
      providers.default?.model, 
      providers.basic?.model
    ].filter(Boolean);
    
    allModels.forEach((modelString: string) => {
      const parts = modelString.split(':');
      const provider = parts[0];
      const model = parts.slice(1).join(':'); // Junta tudo depois do primeiro :
      
      // Encontrar o provider config correspondente
      let providerTimeout = 30000;
      let providerTemperature = 0.1;
      
      for (const [tierName, tierConfig] of Object.entries(providers)) {
        if (tierConfig && (tierConfig as any).model === modelString) {
          providerTimeout = (tierConfig as any).timeout || 30000;
          providerTemperature = (tierConfig as any).temperature || 0.1;
          break;
        }
      }
      
      if (!models[provider]) {
        models[provider] = {
          models: [model],
          timeout: providerTimeout,
          temperature: providerTemperature
        };
        
        // Configurações específicas por provider
        if (provider === 'ollama') {
          models[provider].url = 'http://localhost:11434';
          models[provider].retries = 2;
        }
      } else if (!models[provider].models.includes(model)) {
        models[provider].models.push(model);
        // Usar o maior timeout entre os modelos do mesmo provider
        models[provider].timeout = Math.max(models[provider].timeout || 30000, providerTimeout);
      }
    });
    
    // Retornar config adaptado
    return {
      ...config,
      llm: {
        ...config.llm,
        models
      }
    };
  }
  
  return config;
}