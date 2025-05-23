const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

const TOKEN = 'tokenをいれる';
const CLIENT_ID = 'BOTのclientid';
const GUILD_ID = 'サーバーid';
const VALORANT_ROLE_ID = 'ロールのid';  //VALORANT_ROLE_IDとなっているのは@VALORANTでメンションできると思ってたから　もしかしたら治す
const RECRUIT_CHANNEL_ID = 'チャンネルid';  //募集開始されたときそのメッセージをどこに送るか
// clientidとguildid設定するのはスラッシュコマンドをrestで登録するから。コマンド１回登録しちゃえばrestで毎回作成する必要ないのかもしれないけどよくわからないから毎回更新する
// 多分別ファイルを作ってそこにコマンドを登録するコードを書いて１回だけ実行すればいいんだと思うけどめんどくさいからそのまま　気になったら自分で直してね

const commands = [
  new SlashCommandBuilder()
    .setName('party')
    .setDescription('VALORANTのメンバー募集を開始できるボタンを表示します。')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function ephemeralReply(interaction, options) {
  await interaction.reply({ ...options, flags: 64 });
  setTimeout(async () => {
    try {
      await interaction.deleteReply();
    } catch (e) {
      console.error("Failed to delete ephemeral reply:", e);
    }
  }, 30000);
}

// 募集セッションの一時保管（モーダル送信後のデータ用）
const temporaryRecruitData = {};
// 募集確定後の情報（キュー管理やメッセージ更新用）
const activeParties = {};

async function updateFinalMessage(recruitId) {
  const party = activeParties[recruitId];
  if (!party) return;
  const roleMention = `<@&${VALORANT_ROLE_ID}>`;
  const queueStr = party.queue.length > 0
    ? party.queue.map(id => `<@${id}>`).join(' ')
    : "なし";
  const finalContent = `【募集が開始されました】
募集人数: ${party.recruitedNumberString}
種類: ${party.type}
募集開始時刻: ${party.startTime}
募集期限: ${party.deadlineDisplay}
募集対象: ${party.target}
コメント: ${party.comment}

現在参加予定中のメンバー
${queueStr}

${roleMention}`;
  try {
    const channel = await client.channels.fetch(party.channelId);
    const msg = await channel.messages.fetch(party.messageId);
    await msg.edit({ content: finalContent });
  } catch (err) {
    console.error(err);
  }
}

client.once('ready', () => {
  console.log(`ok ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'party') {
    const startButton = new ButtonBuilder()
      .setCustomId('open_party_modal')
      .setLabel('募集開始')
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(startButton);
    await interaction.reply({ content: '募集開始ボタンを押して詳細を入力してください。', components: [row] });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'open_party_modal') {
    const modal = new ModalBuilder()
      .setCustomId('party_modal')
      .setTitle('募集詳細入力');
    const numInput = new TextInputBuilder()
      .setCustomId('募集人数')
      .setLabel('募集人数 (2,3,4,5,6以上)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('半角数字で入力してください。')
      .setRequired(true);
    const typeInput = new TextInputBuilder()
      .setCustomId('種類')
      .setLabel('ゲームの種類')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例: コンペ')
      .setRequired(true);
    const startTimeInput = new TextInputBuilder()
      .setCustomId('開始時刻')
      .setLabel('開始時刻(必ず形式通りに入力してください。)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例: 21:00')
      .setRequired(false);
    const deadlineInput = new TextInputBuilder()
      .setCustomId('募集期限')
      .setLabel('募集期限(必ず形式通りに入力してください。)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例: 00:00')
      .setRequired(false);
    const targetCommentInput = new TextInputBuilder()
      .setCustomId('募集対象＆コメント')
      .setLabel('コメント 募集対象など')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('200文字以内')
      .setRequired(true);
    const row1 = new ActionRowBuilder().addComponents(numInput);
    const row2 = new ActionRowBuilder().addComponents(typeInput);
    const row3 = new ActionRowBuilder().addComponents(startTimeInput);
    const row4 = new ActionRowBuilder().addComponents(deadlineInput);
    const row5 = new ActionRowBuilder().addComponents(targetCommentInput);
    modal.addComponents(row1, row2, row3, row4, row5);
    await interaction.showModal(modal);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.type !== InteractionType.ModalSubmit) return;
  if (interaction.customId === 'party_modal') {
    const recruitedNumberString = interaction.fields.getTextInputValue('募集人数').trim();
    const type = interaction.fields.getTextInputValue('種類').trim();
    const startTimeRaw = interaction.fields.getTextInputValue('開始時刻').trim();
    const deadlineRaw = interaction.fields.getTextInputValue('募集期限').trim();
    const targetComment = interaction.fields.getTextInputValue('募集対象＆コメント').trim();

    const lines = targetComment.split('\n');
    const targetField = lines[0].trim();
    const commentField = lines.slice(1).join('\n').trim() || "なし";

    // 募集人数で6以上にしたときにキューのマックスを何人にするか　要改善 maxQueueを変更で最大キュー変更
    // 後で気づいたけどそもそも今回フォームに変更したから6以上が入力されることがない。これだと6以上と入力された場合のみの動作なので後で直す。基本的に5人までしか使わないから多分問題なし
    let recruitCount, maxQueue;
    if (recruitedNumberString === '6以上') {
      recruitCount = 6;
      maxQueue = 15;
    } else {
      recruitCount = parseInt(recruitedNumberString);
      if (isNaN(recruitCount) || recruitCount < 1) recruitCount = 1;
      maxQueue = (recruitCount >= 6) ? 15 : recruitCount;
    }
    const startTimeDisplay = startTimeRaw !== "" ? startTimeRaw : "未定";
    const now = new Date();
    let deadlineTimestamp = null;
    let deadlineDisplay = "未定";
    if (deadlineRaw !== "") {
      const [dh, dm] = deadlineRaw.split(':').map(Number);
      let deadlineDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dh, dm);
      if (deadlineDate <= now) {
        deadlineDate.setDate(deadlineDate.getDate() + 1);
      }
      deadlineTimestamp = deadlineDate.getTime();
      deadlineDisplay = deadlineRaw;
    }

    const summary = `## 募集内容確認
募集人数: ${recruitedNumberString}
種類: ${type}
募集開始時刻: ${startTimeDisplay}
募集期限: ${deadlineDisplay}
募集対象: ${targetField}
コメント: ${commentField}

※ 募集開始者は自動的にキューに登録されます。`;

    const recruitId = `${interaction.user.id}-${Date.now()}`;
    temporaryRecruitData[recruitId] = {
      initiator: interaction.user.id,
      recruitedNumberString,
      recruitCount,
      type,
      startTime: startTimeDisplay,
      deadline: deadlineTimestamp,
      deadlineDisplay,
      target: targetField,
      comment: commentField,
      maxQueue,
      queue: []
    };

    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_${recruitId}`)
      .setLabel('募集開始')
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(confirmButton);
    await ephemeralReply(interaction, { content: summary, components: [row] });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('confirm_')) {
    const recruitId = interaction.customId.replace('confirm_', '');
    const data = temporaryRecruitData[recruitId];
    if (!data) {
      await ephemeralReply(interaction, { content: "募集情報が見つかりません。" });
      return;
    }
    delete temporaryRecruitData[recruitId];
    data.queue.push(interaction.user.id);
    const recruitChannel = await client.channels.fetch(RECRUIT_CHANNEL_ID);
    activeParties[recruitId] = {
      ...data,
      initiator: interaction.user.id,
      channelId: recruitChannel.id,
      messageId: null
    };
    const initialContent = `## 募集が開始されました】
募集人数: ${data.recruitedNumberString}
種類: ${data.type}
募集開始時刻: ${data.startTime}
募集期限: ${data.deadlineDisplay}
募集対象: ${data.target}
コメント: ${data.comment}

参加予定中のメンバー
<@${interaction.user.id}>

<@&${VALORANT_ROLE_ID}>`;
    const joinButton = new ButtonBuilder()
      .setCustomId(`join_${recruitId}`)
      .setLabel('参加希望')
      .setStyle(ButtonStyle.Primary);
    const leaveButton = new ButtonBuilder()
      .setCustomId(`leave_${recruitId}`)
      .setLabel('参加を辞める')
      .setStyle(ButtonStyle.Danger);
    const increaseButton = new ButtonBuilder()
      .setCustomId(`increase_${recruitId}`)
      .setLabel('募集人数＋')
      .setStyle(ButtonStyle.Secondary);
    const decreaseButton = new ButtonBuilder()
      .setCustomId(`decrease_${recruitId}`)
      .setLabel('募集人数－')
      .setStyle(ButtonStyle.Secondary);
    const buttonRow = new ActionRowBuilder().addComponents(joinButton, leaveButton, increaseButton, decreaseButton);
    const partyMessage = await recruitChannel.send({ content: initialContent, components: [buttonRow] });
    activeParties[recruitId].messageId = partyMessage.id;
    await ephemeralReply(interaction, { content: "募集が開始されました。", });
    if (activeParties[recruitId].deadline) {
      const msToDeadline = activeParties[recruitId].deadline - Date.now();
      if (msToDeadline > 0) {
        setTimeout(async () => {
          if (activeParties[recruitId]) {
            try {
              const channel = await client.channels.fetch(activeParties[recruitId].channelId);
              const msg = await channel.messages.fetch(activeParties[recruitId].messageId);
              if (msg) {
                const disabledRow = new ActionRowBuilder().addComponents(
                  joinButton.setDisabled(true),
                  leaveButton.setDisabled(true),
                  increaseButton.setDisabled(true),
                  decreaseButton.setDisabled(true)
                );
                await msg.edit({ components: [disabledRow] });
                channel.send("募集期限に達しました。募集は締め切られました。");
              }
            } catch (err) {
              console.error(err);
            }
            delete activeParties[recruitId];
          }
        }, msToDeadline);
      }
    }
    updateFinalMessage(recruitId);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('join_')) {
    const recruitId = interaction.customId.replace('join_', '');
    const party = activeParties[recruitId];
    if (!party) {
      await ephemeralReply(interaction, { content: "募集情報が存在しないか、募集が終了しました。" });
      return;
    }
    if (party.deadline && Date.now() > party.deadline) {
      await ephemeralReply(interaction, { content: "募集期限に達しているため、参加できません。" });
      return;
    }
    if (party.queue.includes(interaction.user.id)) {
      await ephemeralReply(interaction, { content: "既に参加済みです。" });
      return;
    }
    if (party.queue.length >= party.maxQueue) {
      await ephemeralReply(interaction, { content: "これ以上参加できません。募集人数に達しました。" });
      return;
    }
    party.queue.push(interaction.user.id);
    await ephemeralReply(interaction, { content: `参加希望として追加されました。<@${party.initiator}> に通知します。` });
    interaction.channel.send(`<@${party.initiator}>  <@${interaction.user.id}> さんがキューに参加しました。`);
    updateFinalMessage(recruitId);
    const targetCount = (party.recruitedNumberString === '6以上') ? party.maxQueue : party.recruitCount;  //ここも例の6以上
    if (party.queue.length >= targetCount) {
      const allMentions = party.queue.map(id => `<@${id}>`).join(' ');
      await interaction.channel.send(`参加者が集まりました！  ${allMentions}`);
      try {
        const channel = await client.channels.fetch(party.channelId);
        const msg = await channel.messages.fetch(party.messageId);
        if (msg) {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`join_${recruitId}`)
              .setLabel('参加希望')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`leave_${recruitId}`)
              .setLabel('辞退')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`increase_${recruitId}`)
              .setLabel('募集人数＋')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`decrease_${recruitId}`)
              .setLabel('募集人数－')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
          await msg.edit({ components: [disabledRow] });
        }
      } catch (err) {
        console.error(err);
      }
      delete activeParties[recruitId];
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('leave_')) {
    const recruitId = interaction.customId.replace('leave_', '');
    const party = activeParties[recruitId];
    if (!party) {
      await ephemeralReply(interaction, { content: "募集情報が存在しないか、募集が終了しました。" });
      return;
    }
    const idx = party.queue.indexOf(interaction.user.id);
    if (idx === -1) {
      await ephemeralReply(interaction, { content: "あなたは参加していません。" });
      return;
    }
    party.queue.splice(idx, 1);
    await ephemeralReply(interaction, { content: `<@${interaction.user.id}> さんが参加を辞めました。` });
    updateFinalMessage(recruitId);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('increase_')) {
    const recruitId = interaction.customId.replace('increase_', '');
    const party = activeParties[recruitId];
    if (!party) {
      await ephemeralReply(interaction, { content: "募集情報が存在しないか、募集が終了しました。" });
      return;
    }
    party.recruitCount++;
    if (party.recruitCount >= 6) {
      party.recruitedNumberString = "6以上";
      party.maxQueue = 15;
    } else {
      party.recruitedNumberString = party.recruitCount.toString();
      party.maxQueue = party.recruitCount;
    }
    updateFinalMessage(recruitId);
    await ephemeralReply(interaction, { content: `募集人数を${party.recruitedNumberString}に更新しました。` });
    const newTarget = (party.recruitedNumberString === '6以上') ? party.maxQueue : party.recruitCount;
    if (party.queue.length >= newTarget) {
      const mentions = party.queue.map(id => `<@${id}>`).join(' ');
      await interaction.channel.send(`参加者が集まりました！ ${mentions}`);
      try {
        const channel = await client.channels.fetch(party.channelId);
        const msg = await channel.messages.fetch(party.messageId);
        if (msg) {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`join_${recruitId}`)
              .setLabel('参加希望')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`leave_${recruitId}`)
              .setLabel('辞退')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`increase_${recruitId}`)
              .setLabel('募集人数＋')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`decrease_${recruitId}`)
              .setLabel('募集人数－')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
          await msg.edit({ components: [disabledRow] });
        }
      } catch (err) {
        console.error(err);
      }
      delete activeParties[recruitId];
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('decrease_')) {
    const recruitId = interaction.customId.replace('decrease_', '');
    const party = activeParties[recruitId];
    if (!party) {
      await ephemeralReply(interaction, { content: "募集情報が存在しないか、募集が終了しました。" });
      return;
    }
    if (party.recruitCount > 2) {  //1に
      party.recruitCount--;
    }
    if (party.recruitCount >= 6) {
      party.recruitedNumberString = "6以上";
      party.maxQueue = 15;
    } else {
      party.recruitedNumberString = party.recruitCount.toString();
      party.maxQueue = party.recruitCount;
    }
    updateFinalMessage(recruitId);
    await ephemeralReply(interaction, { content: `募集人数を${party.recruitedNumberString}に更新しました。` });
    const newTarget = (party.recruitedNumberString === '6以上') ? party.maxQueue : party.recruitCount;
    if (party.queue.length >= newTarget) {
      const mentions = party.queue.map(id => `<@${id}>`).join(' ');
      await interaction.channel.send(`参加者が集まりました！ ${mentions}`);
      try {
        const channel = await client.channels.fetch(party.channelId);
        const msg = await channel.messages.fetch(party.messageId);
        if (msg) {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`join_${recruitId}`)
              .setLabel('参加希望')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`leave_${recruitId}`)
              .setLabel('辞退')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`increase_${recruitId}`)
              .setLabel('募集人数＋')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`decrease_${recruitId}`)
              .setLabel('募集人数－')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
          await msg.edit({ components: [disabledRow] });
        }
      } catch (err) {
        console.error(err);
      }
      delete activeParties[recruitId];
    }
  }
});

client.login(TOKEN);
