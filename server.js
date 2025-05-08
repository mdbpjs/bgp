// Importações necessárias
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fetch = require('node-fetch');
const { Configuration, OpenAIApi } = require('openai');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente
dotenv.config();

// Configuração Express (para manter o bot ativo no Glitch)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot de Análise de Roleta HanzBet está ativo!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Configuração do bot Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '7609860377:AAEUu2hJ7Y-AzmC03p88jMxDxBSXIFu_ZvI');

// Configuração OpenAI para visão e análise de imagens
const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

// Armazenar sessões de usuários
const userSessions = new Map();

// Link de afiliado da HanzBet
const HANZBET_LINK = 'https://go.aff.hanz.bet.br/d2dyqekb';

// Avisos de jogo responsável
const RESPONSIBLE_GAMING_WARNING = 
  '⚠️ *Aviso de Jogo Responsável*\n' +
  'Lembre-se que este bot fornece apenas análises estatísticas. As probabilidades não garantem resultados futuros.\n' +
  'Jogue com responsabilidade e estabeleça limites. Apenas para maiores de 18 anos.';

// Comandos do bot
bot.start(async (ctx) => {
  // Inicializar sessão do usuário
  initUserSession(ctx.from.id);
  
  await ctx.reply(
    `👋 Olá, ${ctx.from.first_name}! Bem-vindo ao *Analisador de Roleta HanzBet*.\n\n` +
    `Sou um bot especializado em analisar probabilidades da roleta na HanzBet.\n\n` +
    `📱 Para começar, por favor envie um print de tela *completa* da roleta aberta no site da HanzBet.\n\n` +
    `⚠️ Importante: Este bot só funciona com prints da roleta da HanzBet.\n\n` +
    RESPONSIBLE_GAMING_WARNING,
    { parse_mode: 'Markdown' }
  );
});

bot.help((ctx) => {
  ctx.reply(
    '📋 *Comandos disponíveis*:\n\n' +
    '/start - Iniciar o bot\n' +
    '/help - Mostrar esta mensagem de ajuda\n' +
    '/reset - Reiniciar a análise\n' +
    '/balance - Gerenciamento de saldo\n\n' +
    '📸 Para usar o bot, envie um print da tela completa da roleta HanzBet e siga as instruções.\n\n' +
    RESPONSIBLE_GAMING_WARNING,
    { parse_mode: 'Markdown' }
  );
});

bot.command('reset', (ctx) => {
  initUserSession(ctx.from.id);
  ctx.reply('Análise reiniciada. Por favor, envie um print da tela completa da roleta HanzBet.');
});

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    initUserSession(userId);
  }
  
  await askForBalanceManagement(ctx);
});

// Manipulador de fotos
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  // Verificar se a sessão existe
  if (!userSessions.has(userId)) {
    initUserSession(userId);
  }
  
  const session = userSessions.get(userId);
  
  try {
    // Obter o link da foto
    const photo = ctx.message.photo.pop();
    const fileLink = await bot.telegram.getFileLink(photo.file_id);
    
    // Primeiro passo: verificar se é um print da HanzBet
    if (session.state === 'WAITING_FOR_SITE_SCREENSHOT') {
      await ctx.reply('🔍 Analisando o screenshot da roleta...');
      
      const siteValidation = await validateHanzBetSite(fileLink);
      
      if (!siteValidation.isValid) {
        return ctx.reply(
          '❌ *Site não reconhecido como HanzBet*\n\n' +
          'Este bot foi projetado exclusivamente para a roleta da HanzBet.\n\n' +
          'Por favor, envie um print da tela completa mostrando a roleta aberta no site hanz.bet.br.\n\n' +
          `🔗 Não tem conta? [Cadastre-se aqui](${HANZBET_LINK})`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Site validado como HanzBet
      session.state = 'WAITING_FOR_HISTORY_SCREENSHOT';
      
      return ctx.reply(
        '✅ *Site HanzBet reconhecido com sucesso!*\n\n' +
        'Agora, por favor, envie um print da tela com o *histórico completo* de números da roleta.\n\n' +
        'Dica: Clique no botão de estatísticas da roleta para mostrar o histórico mais completo.',
        { parse_mode: 'Markdown' }
      );
    }
    
    // Segundo passo: analisar o histórico da roleta
    if (session.state === 'WAITING_FOR_HISTORY_SCREENSHOT' || session.state === 'WAITING_FOR_NEXT_ROUND') {
      await ctx.reply('🔍 Analisando o histórico da roleta...');
      
      const historyAnalysis = await analyzeRouletteHistory(fileLink);
      
      if (!historyAnalysis.success) {
        return ctx.reply(
          '❌ *Não foi possível identificar o histórico da roleta*\n\n' +
          'Por favor, envie um print mais claro e nítido do histórico de rodadas da roleta.\n\n' +
          'Certifique-se de que os números estão visíveis na imagem.',
          { parse_mode: 'Markdown' }
        );
      }
      
      // Armazenar o histórico na sessão
      session.history = historyAnalysis.numbers;
      session.lastAnalysis = historyAnalysis;
      
      if (session.state === 'WAITING_FOR_HISTORY_SCREENSHOT') {
        session.state = 'HISTORY_ANALYZED';
        
        // Mostrar opções de análise
        await showAnalysisOptions(ctx, session);
      } else if (session.state === 'WAITING_FOR_NEXT_ROUND') {
        // Nova rodada recebida, mostrar atualização
        await showUpdatedAnalysis(ctx, session);
      }
    }
  } catch (error) {
    console.error('Erro ao processar imagem:', error);
    ctx.reply('❌ Ocorreu um erro ao processar a imagem. Por favor, tente novamente com outro print.');
  }
});

// Manipulador de mensagens de texto
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.toLowerCase();
  
  if (!userSessions.has(userId)) {
    initUserSession(userId);
    return ctx.reply('Por favor, envie um print da tela completa da roleta HanzBet para começar.');
  }
  
  const session = userSessions.get(userId);
  
  // Verificar estado da sessão e texto recebido
  if (session.state === 'ASKING_FOR_BALANCE_MANAGEMENT') {
    if (text.includes('sim') || text === 's' || text === 'yes' || text === 'y') {
      session.state = 'ASKING_FOR_MARTINGALE';
      
      return ctx.reply(
        '🎮 *Gerenciamento de Saldo - Martingale*\n\n' +
        'Você deseja utilizar a estratégia Martingale?\n\n' +
        '(Martingale é uma estratégia onde você dobra a aposta após cada perda, visando recuperar o valor perdido)',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('Com Martingale', 'martingale_yes'),
              Markup.button.callback('Sem Martingale', 'martingale_no')
            ]
          ])
        }
      );
    } else {
      session.state = 'HISTORY_ANALYZED';
      
      return ctx.reply(
        'Você optou por não utilizar sugestões de gerenciamento de saldo.\n\n' +
        'Envie um novo print do histórico da roleta quando desejar fazer uma nova análise.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Ver opções de análise', 'show_analysis_options')]
          ])
        }
      );
    }
  }
  
  if (session.state === 'ASKING_FOR_MARTINGALE_HANDS') {
    const hands = parseInt(text);
    
    if (isNaN(hands) || hands < 1) {
      return ctx.reply('Por favor, informe um número válido de mãos para a estratégia Martingale.');
    }
    
    session.martingaleHands = hands;
    session.state = 'READY_FOR_BALANCE_SUGGESTION';
    
    return suggestBalanceManagement(ctx, session);
  }
  
  if (session.state === 'WAITING_FOR_BALANCE') {
    const balance = parseFloat(text.replace(',', '.'));
    
    if (isNaN(balance) || balance <= 0) {
      return ctx.reply('Por favor, informe um valor válido para o seu saldo.');
    }
    
    session.balance = balance;
    session.state = 'BALANCE_PROVIDED';
    
    return provideBettingStrategy(ctx, session);
  }
  
  // Resposta genérica para outras mensagens de texto
  ctx.reply(
    'Por favor, envie um print da roleta para análise ou utilize os comandos disponíveis (/help para ver a lista).\n\n' +
    'Se quiser gerenciar seu saldo, use o comando /balance.'
  );
});

// Manipulador de callbacks (botões inline)
bot.action(/analyze_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    return ctx.reply('Sessão expirada. Por favor, use /start para recomeçar.');
  }
  
  const session = userSessions.get(userId);
  
  if (!session.history || session.history.length === 0) {
    return ctx.reply('Não há histórico para analisar. Por favor, envie novamente um print do histórico da roleta.');
  }
  
  const analysisType = ctx.match[1];
  let analysis = '';
  
  switch(analysisType) {
    case 'dozens':
      analysis = analyzeDozens(session.history);
      break;
    case 'columns':
      analysis = analyzeColumns(session.history);
      break;
    case 'colors':
      analysis = analyzeColors(session.history);
      break;
    case 'exact':
      analysis = analyzeExactNumbers(session.history);
      break;
    case 'neighbors':
      analysis = analyzeNeighbors(session.history);
      break;
    case 'zero':
      analysis = analyzeZero(session.history);
      break;
    case 'all':
      // Análise completa de tudo
      const colorAnalysis = analyzeColors(session.history);
      const dozenAnalysis = analyzeDozens(session.history);
      const columnAnalysis = analyzeColumns(session.history);
      const zeroAnalysis = analyzeZero(session.history);
      
      analysis = `📊 *Análise Completa*\n\n${colorAnalysis}\n\n${dozenAnalysis}\n\n${columnAnalysis}\n\n${zeroAnalysis}`;
      break;
    default:
      analysis = 'Tipo de análise não reconhecido.';
  }
  
  await ctx.reply(analysis, { parse_mode: 'Markdown' });
  
  // Perguntar se deseja continuar
  setTimeout(() => {
    askContinue(ctx);
  }, 1000);
});

bot.action('show_analysis_options', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    return ctx.reply('Sessão expirada. Por favor, use /start para recomeçar.');
  }
  
  const session = userSessions.get(userId);
  
  if (!session.history || session.history.length === 0) {
    return ctx.reply('Não há histórico para analisar. Por favor, envie um print do histórico da roleta.');
  }
  
  await showAnalysisOptions(ctx, session);
});

bot.action('balance_management', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    initUserSession(userId);
  }
  
  await askForBalanceManagement(ctx);
});

bot.action(/martingale_(yes|no)/, async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    return ctx.reply('Sessão expirada. Por favor, use /start para recomeçar.');
  }
  
  const session = userSessions.get(userId);
  const useMartingale = ctx.match[1] === 'yes';
  
  session.useMartingale = useMartingale;
  
  if (useMartingale) {
    session.state = 'ASKING_FOR_MARTINGALE_HANDS';
    
    return ctx.reply(
      '🔢 *Gerenciamento de Saldo - Mãos Martingale*\n\n' +
      'Quantas mãos (níveis) você deseja utilizar na estratégia Martingale?\n\n' +
      'Recomendação: Entre 2 e 5 mãos.\n\n' +
      'Por favor, responda com um número.',
      { parse_mode: 'Markdown' }
    );
  } else {
    session.martingaleHands = 0;
    session.state = 'READY_FOR_BALANCE_SUGGESTION';
    
    return suggestBalanceManagement(ctx, session);
  }
});

bot.action(/strategy_(conservative|moderate|aggressive)/, async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    return ctx.reply('Sessão expirada. Por favor, use /start para recomeçar.');
  }
  
  const strategy = ctx.match[1];
  const session = userSessions.get(userId);
  
  session.selectedStrategy = strategy;
  session.state = 'WAITING_FOR_BALANCE';
  
  let message = '';
  let betPercentage = 0;
  
  switch(strategy) {
    case 'conservative':
      betPercentage = 1;
      message = 
        '🛡️ *Estratégia Conservadora Selecionada*\n\n' +
        'Você optou pela gestão conservadora, que utiliza 1% do seu saldo por aposta.\n\n' +
        'Esta estratégia minimiza perdas, mas também reduz os ganhos potenciais.\n\n' +
        'Ideal para sessões longas e jogadores que preferem segurança.';
      break;
    case 'moderate':
      betPercentage = 3;
      message = 
        '⚖️ *Estratégia Moderada Selecionada*\n\n' +
        'Você optou pela gestão moderada, que utiliza 3% do seu saldo por aposta.\n\n' +
        'Esta estratégia busca equilibrar risco e recompensa.\n\n' +
        'Recomendada para a maioria dos jogadores.';
      break;
    case 'aggressive':
      betPercentage = 5;
      message = 
        '🔥 *Estratégia Agressiva Selecionada*\n\n' +
        'Você optou pela gestão agressiva, que utiliza 5% do seu saldo por aposta.\n\n' +
        'Esta estratégia busca maximizar ganhos, mas aumenta o risco de perdas significativas.\n\n' +
        'Recomendada apenas para jogadores experientes.';
      break;
  }
  
  session.betPercentage = betPercentage;
  
  await ctx.reply(
    message + '\n\n' + 
    'Por favor, informe seu saldo atual para receber recomendações específicas:',
    { parse_mode: 'Markdown' }
  );
});

bot.action('continue_analysis', (ctx) => {
  const userId = ctx.from.id;
  
  if (!userSessions.has(userId)) {
    return ctx.reply('Sessão expirada. Por favor, use /start para recomeçar.');
  }
  
  const session = userSessions.get(userId);
  session.state = 'WAITING_FOR_NEXT_ROUND';
  
  ctx.reply(
    '📸 Por favor, envie um novo print do histórico da roleta para atualizar a análise.\n\n' +
    'Envie após a próxima rodada para incluir o resultado mais recente.'
  );
});

bot.action('new_analysis', (ctx) => {
  const userId = ctx.from.id;
  initUserSession(userId);
  ctx.reply('Vamos começar uma nova análise. Por favor, envie um print da tela completa da roleta HanzBet.');
});

// Função para inicializar sessão do usuário
function initUserSession(userId) {
  userSessions.set(userId, {
    state: 'WAITING_FOR_SITE_SCREENSHOT',
    history: [],
    previousHistory: [],
    lastAnalysis: null,
    useMartingale: false,
    martingaleHands: 0,
    selectedStrategy: null,
    betPercentage: 0,
    balance: 0
  });
}

// Função para validar se o site é HanzBet
async function validateHanzBetSite(imageUrl) {
  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "system",
          content: "Você é um assistente especializado em verificar screenshots de sites. Sua tarefa é identificar se a imagem mostra o site HanzBet aberto. Procure pelo URL 'hanz.bet.br' na barra de navegação ou o logo 'HanzBet' no topo do site. Responda apenas com 'sim' se for o site HanzBet, ou 'não' se for outro site."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Esta imagem mostra o site HanzBet?" },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 50
    });
    
    const result = response.data.choices[0].message.content.toLowerCase();
    return { 
      isValid: result.includes('sim'),
      details: result
    };
  } catch (error) {
    console.error("Erro ao validar site:", error);
    return { isValid: false, details: "Erro ao processar imagem" };
  }
}

// Função para analisar o histórico da roleta
async function analyzeRouletteHistory(imageUrl) {
  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "system",
          content: "Você é um assistente especializado em analisar imagens de roletas de cassino. Sua tarefa é identificar os números do histórico de rodadas mostrados na imagem. Retorne apenas uma lista de números encontrados, separados por vírgula, na ordem em que aparecem (do mais recente para o mais antigo). Se não conseguir identificar o histórico, responda apenas com 'Não foi possível identificar o histórico'."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Quais são os números no histórico desta roleta?" },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 500
    });
    
    const result = response.data.choices[0].message.content;
    
    if (result.toLowerCase().includes('não foi possível')) {
      return { success: false, message: result };
    }
    
    // Extrair números do resultado
    const numberPattern = /\b([0-9]|[1-2][0-9]|3[0-6])\b/g;
    const numbers = [];
    
    let match;
    while ((match = numberPattern.exec(result)) !== null) {
      numbers.push(parseInt(match[0]));
    }
    
    return {
      success: numbers.length > 0,
      numbers: numbers,
      rawResponse: result
    };
  } catch (error) {
    console.error("Erro ao analisar histórico:", error);
    return { success: false, message: "Erro ao processar imagem" };
  }
}

// Função para mostrar opções de análise
async function showAnalysisOptions(ctx, session) {
  await ctx.reply(
    `✅ *Histórico identificado com sucesso!*\n\n` +
    `Identifiquei um histórico de ${session.history.length} rodadas.\n\n` +
    `Escolha abaixo o tipo de análise que deseja:`,
    { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('Análise Completa', 'analyze_all')
        ],
        [
          Markup.button.callback('Cores', 'analyze_colors'),
          Markup.button.callback('Dúzias', 'analyze_dozens')
        ],
        [
          Markup.button.callback('Colunas', 'analyze_columns'),
          Markup.button.callback('Números', 'analyze_exact')
        ],
        [
          Markup.button.callback('Vizinhos', 'analyze_neighbors'),
          Markup.button.callback('Zero', 'analyze_zero')
        ],
        [
          Markup.button.callback('Gerenciar Saldo', 'balance_management')
        ]
      ])
    }
  );
}

// Função para mostrar análise atualizada
async function showUpdatedAnalysis(ctx, session) {
  const lastNumber = session.history[0];
  const previousHistory = session.previousHistory || [];
  
  let newNumber = true;
  if (previousHistory.length > 0 && previousHistory[0] === lastNumber) {
    newNumber = false;
  }
  
  // Atualizar histórico anterior
  session.previousHistory = [...session.history];
  
  if (newNumber) {
    await ctx.reply(
      `🆕 *Nova rodada detectada*: ${lastNumber}\n\n` +
      `O histórico foi atualizado com sucesso. Agora temos ${session.history.length} rodadas para análise.`,
      { parse_mode: 'Markdown' }
    );
    
    // Mostrar análise rápida
    const colorAnalysis = analyzeColors(session.history.slice(0, 10));
    await ctx.reply(
      `📊 *Análise Rápida (últimas 10 rodadas)*\n\n${colorAnalysis}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(
      `📊 *Histórico atualizado*\n\n` +
      `Não detectei um novo número. O último número continua sendo ${lastNumber}.\n\n` +
      `Temos ${session.history.length} rodadas para análise.`,
      { parse_mode: 'Markdown' }
    );
  }
  
  setTimeout(() => {
    askContinue(ctx);
  }, 1000);
}

// Função para perguntar se deseja continuar
function askContinue(ctx) {
  ctx.reply(
    '🔄 *O que você deseja fazer agora?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('Atualizar com nova rodada', 'continue_analysis'),
          Markup.button.callback('Ver opções de análise', 'show_analysis_options')
        ],
        [
          Markup.button.callback('Gerenciar Saldo', 'balance_management'),
          Markup.button.callback('Nova análise', 'new_analysis')
        ]
      ])
    }
  );
}

// Função para perguntar sobre gerenciamento de saldo
async function askForBalanceManagement(ctx) {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  
  session.state = 'ASKING_FOR_BALANCE_MANAGEMENT';
  
  await ctx.reply(
    '💰 *Gerenciamento de Saldo*\n\n' +
    'Deseja receber sugestões de gerenciamento de saldo para suas apostas?\n\n' +
    'Isso ajudará a otimizar suas apostas com base nas probabilidades.',
    { parse_mode: 'Markdown' }
  );
}

// Função para sugerir estratégias de gerenciamento de saldo
async function suggestBalanceManagement(ctx, session) {
  await ctx.reply(
    '💼 *Estratégias de Gerenciamento de Saldo*\n\n' +
    'Escolha uma das estratégias abaixo:\n\n' +
    '🛡️ *Conservadora*: 1% do saldo por aposta\n' +
    '⚖️ *Moderada*: 3% do saldo por aposta\n' +
    '🔥 *Agressiva*: 5% do saldo por aposta\n\n' +
    `${session.useMartingale ? `Martingale configurado para ${session.martingaleHands} mãos.` : 'Sem Martingale.'}\n\n` +
    RESPONSIBLE_GAMING_WARNING,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🛡️ Conservadora', 'strategy_conservative'),
          Markup.button.callback('⚖️ Moderada', 'strategy_moderate'),
          Markup.button.callback('🔥 Agressiva', 'strategy_aggressive')
        ]
      ])
    }
  );
}

// Função para fornecer a estratégia de apostas
async function provideBettingStrategy(ctx, session) {
  const baseValue = session.balance * (session.betPercentage / 100);
  const formattedBaseValue = baseValue.toFixed(2);
  
  let message = '';
  
  if (session.useMartingale) {
    // Calcular valores do Martingale
    let martingaleValues = [];
    let currentValue = baseValue;
    
    for (let i = 0; i < session.martingaleHands; i++) {
      martingaleValues.push(currentValue.toFixed(2));
      currentValue *= 2; // Dobrar para próxima mão
    }
    
    const totalExposure = martingaleValues.reduce((sum, value) => sum + parseFloat(value), 0);
    const exposurePercent = ((totalExposure / session.balance) * 100).toFixed(2);
    
    message = 
      `💰 *Plano de Apostas com Martingale*\n\n` +
      `Saldo: R$ ${session.balance.toFixed(2)}\n` +
      `Estratégia: ${session.selectedStrategy.charAt(0).toUpperCase() + session.selectedStrategy.slice(1)} (${session.betPercentage}%)\n\n` +
      `🎯 *Valor Base*: R$ ${formattedBaseValue}\n\n` +
      `🔄 *Progressão Martingale (${session.martingaleHands} mãos)*:\n`;
    
    martingaleValues.forEach((value, index) => {
      message += `Mão ${index + 1}: R$ ${value}\n`;
    });
    
    message += `\n⚠️ *Exposição Total*: R$ ${totalExposure.toFixed(2)} (${exposurePercent}% do saldo)\n\n`;
    
    // Adicionar recomendações baseadas na exposição
    if (parseFloat(exposurePercent) > 50) {
      message += `⚠️ *Alerta*: Esta estratégia possui alta exposição ao risco. Considere reduzir o número de mãos ou utilizar uma estratégia mais conservadora.\n\n`;
    }
  } else {
    // Sem Martingale
    message = 
      `💰 *Plano de Apostas Simples*\n\n` +
      `Saldo: R$ ${session.balance.toFixed(2)}\n` +
      `Estratégia: ${session.selectedStrategy.charAt(0).toUpperCase() + session.selectedStrategy.slice(1)} (${session.betPercentage}%)\n\n` +
      `🎯 *Valor por Aposta*: R$ ${formattedBaseValue}\n\n` +
      `Com este valor, você poderá fazer aproximadamente ${Math.floor(session.balance / baseValue)} apostas antes de esgotar seu saldo.\n\n`;
  }
  
  // Adicionar sempre o aviso de jogo responsável
  message += RESPONSIBLE_GAMING_WARNING;
  
  await ctx.reply(message, { parse_mode: 'Markdown' });
  
  // Perguntar se deseja continuar
  setTimeout(() => {
    askContinue(ctx);
  }, 1000);
}

// Função para analisar cores
function analyzeColors(history) {
  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const blackNumbers = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];
  
  let redCount = 0;
  let blackCount = 0;
  let zeroCount = 0;
  
  history.forEach(num => {
    if (num === 0) {
      zeroCount++;
    } else if (redNumbers.includes(num)) {
      redCount++;
    } else if (blackNumbers.includes(num)) {
      blackCount++;
    }
  });
  
  const total = history.length;
  const redPercent = ((redCount / total) * 100).toFixed(1);
  const blackPercent = ((blackCount / total) * 100).toFixed(1);
  const zeroPercent = ((zeroCount / total) * 100).toFixed(1);
  
  // Determinar tendência
  let suggestion = '';
  let emojiTendency = '';
  
  if (redCount > blackCount && redCount > total * 0.55) {
    suggestion = 'VERMELHO';
    emojiTendency = '🔴';
  } else if (blackCount > redCount && blackCount > total * 0.55) {
    suggestion = 'PRETO';
    emojiTendency = '⚫';
  } else if (zeroCount > total * 0.1) {
    suggestion = 'Atenção para o ZERO';
    emojiTendency = '🟢';
  } else {
    suggestion = 'Sem tendência clara';
    emojiTendency = '⚖️';
  }
  
  return `🎯 *Análise de Cores* (${total} rodadas)\n\n` +
         `🔴 Vermelho: ${redCount}x (${redPercent}%)\n` +
         `⚫ Preto: ${blackCount}x (${blackPercent}%)\n` +
         `🟢 Zero: ${zeroCount}x (${zeroPercent}%)\n\n` +
         `${emojiTendency} Tendência: ${suggestion}`;
}

// Função para analisar dúzias
function analyzeDozens(history) {
  let firstDozen = 0;  // 1-12
  let secondDozen = 0; // 13-24
  let thirdDozen = 0;  // 25-36
  let zero = 0;        // 0
  
  history.forEach(num => {
    if (num === 0) {
      zero++;
    } else if (num >= 1 && num <= 12) {
      firstDozen++;
    } else if (num >= 13 && num <= 24) {
      secondDozen++;
    } else if (num >= 25 && num <= 36) {
      thirdDozen++;
    }
  });
  
  const total = history.length;
  const firstPercent = ((firstDozen / total) * 100).toFixed(1);
  const secondPercent = ((secondDozen / total) * 100).toFixed(1);
  const thirdPercent = ((thirdDozen / total) * 100).toFixed(1);
  const zeroPercent = ((zero / total) * 100).toFixed(1);
  
  // Determinar tendência
  let suggestion = '';
  let emoji = '';
  const maxDozen = Math.max(firstDozen, secondDozen, thirdDozen);
  
  if (maxDozen === firstDozen && firstDozen > total * 0.4) {
    suggestion = 'PRIMEIRA DÚZIA';
    emoji = '1️⃣';
  } else if (maxDozen === secondDozen && secondDozen > total * 0.4) {
    suggestion = 'SEGUNDA DÚZIA';
    emoji = '2️⃣';
  } else if (maxDozen === thirdDozen && thirdDozen > total * 0.4) {
    suggestion = 'TERCEIRA DÚZIA';
    emoji = '3️⃣';
  } else {
    suggestion = 'Sem tendência clara';
    emoji = '⚖️';
  }
  
  return `🎯 *Análise de Dúzias* (${total} rodadas)\n\n` +
         `1️⃣ Primeira Dúzia (1-12): ${firstDozen}x (${firstPercent}%)\n` +
         `2️⃣ Segunda Dúzia (13-24): ${secondDozen}x (${secondPercent}%)\n` +
         `3️⃣ Terceira Dúzia (25-36): ${thirdDozen}x (${thirdPercent}%)\n` +
         `🟢 Zero: ${zero}x (${zeroPercent}%)\n\n` +
         `${emoji} Tendência: ${suggestion}`;
}

// Função para analisar colunas
function analyzeColumns(history) {
  let firstColumn = 0;  // 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34
  let secondColumn = 0; // 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35
  let thirdColumn = 0;  // 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36
  let zero = 0;        // 0
  
  const col1 = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
  const col2 = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
  const col3 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
  
  history.forEach(num => {
    if (num === 0) {
      zero++;
    } else if (col1.includes(num)) {
      firstColumn++;
    } else if (col2.includes(num)) {
      secondColumn++;
    } else if (col3.includes(num)) {
      thirdColumn++;
    }
  });
  
  const total = history.length;
  const firstPercent = ((firstColumn / total) * 100).toFixed(1);
  const secondPercent = ((secondColumn / total) * 100).toFixed(1);
  const thirdPercent = ((thirdColumn / total) * 100).toFixed(1);
  const zeroPercent = ((zero / total) * 100).toFixed(1);
  
  // Determinar tendência
  let suggestion = '';
  let emoji = '';
  const maxColumn = Math.max(firstColumn, secondColumn, thirdColumn);
  
  if (maxColumn === firstColumn && firstColumn > total * 0.4) {
    suggestion = 'PRIMEIRA COLUNA';
    emoji = '1️⃣';
  } else if (maxColumn === secondColumn && secondColumn > total * 0.4) {
    suggestion = 'SEGUNDA COLUNA';
    emoji = '2️⃣';
  } else if (maxColumn === thirdColumn && thirdColumn > total * 0.4) {
    suggestion = 'TERCEIRA COLUNA';
    emoji = '3️⃣';
  } else {
    suggestion = 'Sem tendência clara';
    emoji = '⚖️';
  }
  
  return `🎯 *Análise de Colunas* (${total} rodadas)\n\n` +
         `1️⃣ Primeira Coluna: ${firstColumn}x (${firstPercent}%)\n` +
         `2️⃣ Segunda Coluna: ${secondColumn}x (${secondPercent}%)\n` +
         `3️⃣ Terceira Coluna: ${thirdColumn}x (${thirdPercent}%)\n` +
         `🟢 Zero: ${zero}x (${zeroPercent}%)\n\n` +
         `${emoji} Tendência: ${suggestion}`;
}

// Função para analisar números exatos
function analyzeExactNumbers(history) {
  // Contagem de frequência de cada número
  const frequencyMap = {};
  for (let i = 0; i <= 36; i++) {
    frequencyMap[i] = 0;
  }
  
  history.forEach(num => {
    if (num >= 0 && num <= 36) {
      frequencyMap[num]++;
    }
  });
  
  // Encontrar os 5 números mais frequentes
  const sortedNumbers = Object.entries(frequencyMap)
    .sort((a, b) => b[1] - a[1])
    .map(entry => ({
      number: parseInt(entry[0]),
      count: entry[1],
      percentage: ((entry[1] / history.length) * 100).toFixed(1)
    }));
  
  const hotNumbers = sortedNumbers.slice(0, 5);
  const coldNumbers = sortedNumbers
    .filter(entry => entry.count > 0) // Filtrar apenas números que apareceram
    .slice(-5)
    .reverse();
  
  let response = `🎯 *Análise de Números Exatos* (${history.length} rodadas)\n\n`;
  
  response += `🔥 *Números Quentes (mais frequentes)*:\n`;
  hotNumbers.forEach(entry => {
    response += `${entry.number}: ${entry.count}x (${entry.percentage}%)\n`;
  });
  
  response += `\n❄️ *Números Frios (menos frequentes)*:\n`;
  coldNumbers.forEach(entry => {
    response += `${entry.number}: ${entry.count}x (${entry.percentage}%)\n`;
  });
  
  // Determinar tendência
  if (hotNumbers.length > 0 && hotNumbers[0].count >= 3) {
    response += `\n⭐ *Sugestão*: O número ${hotNumbers[0].number} apareceu ${hotNumbers[0].count} vezes e pode estar quente.`;
  } else {
    response += `\n⚠️ Não há números com frequência claramente dominante.`;
  }
  
  return response;
}

// Função para analisar vizinhos
function analyzeNeighbors(history) {
  if (history.length < 3) {
    return "⚠️ *Análise de Vizinhos*\n\nPreciso de pelo menos 3 rodadas para analisar padrões de vizinhos.";
  }
  
  // Ordem dos números na roleta europeia
  const rouletteOrder = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 
    11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 
    22, 18, 29, 7, 28, 12, 35, 3, 26
  ];
  
  // Mapear posições dos números na roleta
  const positionMap = {};
  rouletteOrder.forEach((num, index) => {
    positionMap[num] = index;
  });
  
  // Analisar últimas rodadas para ver padrões de vizinhança
  let neighborSequences = [];
  
  for (let i = 0; i < history.length - 1; i++) {
    const currentNum = history[i];
    const previousNum = history[i + 1];
    
    if (currentNum === undefined || previousNum === undefined) continue;
    
    const currentPos = positionMap[currentNum];
    const previousPos = positionMap[previousNum];
    
    if (currentPos === undefined || previousPos === undefined) continue;
    
    // Calcular distância (número de casas) entre os números na roleta
    let distance = Math.abs(currentPos - previousPos);
    if (distance > 18) distance = 37 - distance; // Pegar o caminho mais curto (roleta é circular)
    
    neighborSequences.push({
      from: previousNum,
      to: currentNum,
      distance: distance
    });
  }
  
  // Contar frequência de distâncias
  const distanceFrequency = {};
  for (let i = 1; i <= 18; i++) {
    distanceFrequency[i] = 0;
  }
  
  neighborSequences.forEach(seq => {
    distanceFrequency[seq.distance]++;
  });
  
  // Encontrar distâncias mais comuns
  const sortedDistances = Object.entries(distanceFrequency)
    .sort((a, b) => b[1] - a[1])
    .map(entry => ({
      distance: parseInt(entry[0]),
      count: entry[1],
      percentage: ((entry[1] / neighborSequences.length) * 100).toFixed(1)
    }));
  
  // Identificar "setores quentes" na roleta
  let hotSectors = [];
  
  if (history.length >= 5) {
    // Dividir a roleta em 4 setores e contar hits
    const sectors = [
      {name: "Setor Zero", numbers: [0, 32, 15, 19, 4, 21, 2, 25, 17]},
      {name: "Setor Órfãos", numbers: [34, 6, 27, 13, 36, 11, 30, 8]},
      {name: "Setor Série 5/8", numbers: [23, 10, 5, 24, 16, 33, 1, 20, 14, 31]},
      {name: "Setor Tiers", numbers: [9, 22, 18, 29, 7, 28, 12, 35, 3, 26]}
    ];
    
    sectors.forEach(sector => {
      const hits = history.filter(num => sector.numbers.includes(num)).length;
      const percentage = ((hits / history.length) * 100).toFixed(1);
      hotSectors.push({
        name: sector.name,
        hits: hits,
        percentage: percentage
      });
    });
    
    hotSectors.sort((a, b) => b.hits - a.hits);
  }
  
  // Preparar resposta
  let response = `🎯 *Análise de Vizinhos e Setores* (${history.length} rodadas)\n\n`;
  
  if (sortedDistances.length > 0 && sortedDistances[0].count > 1) {
    response += `🔄 *Padrão de Distância*\n`;
    response += `Distância ${sortedDistances[0].distance} casas: ${sortedDistances[0].count}x (${sortedDistances[0].percentage}%)\n`;
    
    if (sortedDistances.length > 1) {
      response += `Distância ${sortedDistances[1].distance} casas: ${sortedDistances[1].count}x (${sortedDistances[1].percentage}%)\n`;
    }
  }
  
  if (hotSectors.length > 0) {
    response += `\n🔥 *Setores Quentes*\n`;
    response += `${hotSectors[0].name}: ${hotSectors[0].hits}x (${hotSectors[0].percentage}%)\n`;
    response += `${hotSectors[1].name}: ${hotSectors[1].hits}x (${hotSectors[1].percentage}%)\n`;
    
    // Sugestão
    if (parseFloat(hotSectors[0].percentage) > 35) {
      response += `\n⭐ *Sugestão*: O ${hotSectors[0].name} está ativo (${hotSectors[0].percentage}% das rodadas).`;
    } else {
      response += `\n⚠️ Não há setores com dominância clara.`;
    }
  }
  
  return response;
}

// Função para analisar zero
function analyzeZero(history) {
  const zeroCount = history.filter(num => num === 0).length;
  const total = history.length;
  const zeroPercent = ((zeroCount / total) * 100).toFixed(1);
  
  // Analisar padrões após o zero
  let afterZeroPatterns = [];
  let lastZeroIndex = -1;
  
  for (let i = 0; i < history.length; i++) {
    if (history[i] === 0) {
      lastZeroIndex = i;
    } else if (lastZeroIndex !== -1 && i - lastZeroIndex <= 5) {
      // Registrar números que ocorreram até 5 posições após o zero
      afterZeroPatterns.push({
        number: history[i],
        position: i - lastZeroIndex
      });
    }
  }
  
  // Agrupar por posição após o zero
  const afterZeroByPosition = {};
  for (let i = 1; i <= 5; i++) {
    afterZeroByPosition[i] = [];
  }
  
  afterZeroPatterns.forEach(pattern => {
    if (afterZeroByPosition[pattern.position]) {
      afterZeroByPosition[pattern.position].push(pattern.number);
    }
  });
  
  // Probabilidade teórica do zero
  const theoreticalProbability = 2.7; // Roleta europeia
  
  // Preparar resposta
  let response = `🎯 *Análise do Zero* (${total} rodadas)\n\n`;
  response += `🟢 Zero: ${zeroCount}x (${zeroPercent}%)\n`;
  response += `ℹ️ Probabilidade teórica: 2.7% (Roleta Europeia)\n\n`;
  
  // Comparar com probabilidade teórica
  if (zeroCount > 0) {
    if (parseFloat(zeroPercent) > theoreticalProbability * 1.5) {
      response += `⚠️ *Alerta*: O zero está aparecendo com frequência ${(parseFloat(zeroPercent) / theoreticalProbability).toFixed(1)}x maior que o esperado!\n\n`;
    } else if (parseFloat(zeroPercent) < theoreticalProbability * 0.5) {
      response += `👀 *Observação*: O zero está aparecendo menos que o esperado (${(parseFloat(zeroPercent) / theoreticalProbability).toFixed(1)}x menos).\n\n`;
    }
    
    // Analisar padrões após o zero
    if (afterZeroPatterns.length > 0) {
      response += `🔄 *Após o Zero*:\n`;
      
      for (let position = 1; position <= 3; position++) { // Mostrar apenas 3 posições após o zero
        if (afterZeroByPosition[position] && afterZeroByPosition[position].length > 0) {
          const numbers = afterZeroByPosition[position];
          response += `${position}ª rodada após: ${numbers.join(', ')}\n`;
        }
      }
    }
  } else {
    response += `⚠️ O zero não apareceu nas últimas ${total} rodadas analisadas.`;
  }
  
  return response;
}

// Configuração manual do webhook no Express e no Telegram
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7609860377:AAEUu2hJ7Y-AzmC03p88jMxDxBSXIFu_ZvI';
const PROJECT_URL = process.env.RAILWAY_STATIC_URL || 'https://bgp-production.up.railway.app';

// Configurar webhook no Express
app.use(express.json());
  
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// Configurar webhook no Telegram manualmente
bot.telegram.setWebhook(`${PROJECT_URL}/bot${TOKEN}`)
  .then(success => {
    console.log('Webhook configurado com sucesso:', success);
  })
  .catch(error => {
    console.error('Erro ao configurar webhook:', error);
  });

// Configurar keepalive para evitar que o Glitch adormeça
const keepAlive = () => {
  setInterval(() => {
    console.log("Keeping bot alive...");
    // Fazer ping para manter o serviço ativo
    fetch(URL)
      .catch(err => console.error("Error pinging service:", err));
  }, 280000); // a cada 4 minutos e 40 segundos
};

keepAlive();

// Tratamento de erros
bot.catch((err, ctx) => {
  console.error('Erro não tratado:', err);
  ctx.reply('❌ Ocorreu um erro inesperado. Por favor, tente novamente ou use /reset para reiniciar.');
});

console.log('Bot de Análise de Roleta HanzBet iniciado!');
