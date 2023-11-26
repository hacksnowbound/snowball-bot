const { App: BoltApp } = require("@slack/bolt");
const { Octokit } = require("@octokit/core");
const { createAppAuth, createOAuthUserAuth } = require("@octokit/auth-app");

require("dotenv").config();

let repoCreationChannel = "C0643HAAE87";
let repoApprovalsChannel = "C064QCFNNBE";

(async () => {
    const slackapp = new BoltApp({
        token: process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        socketMode: true,
        appToken: process.env.SLACK_APP_TOKEN,
    });

    const OCTOBOT = new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: process.env.GITHUB_APP_ID,
            privateKey: process.env.GITHUB_PRIVATE_KEY,
            installationId: process.env.GITHUB_INSTALLATION_ID,
        },
    });

    const port = 3000;
    await slackapp.start(process.env.PORT || port);
    console.log(`⚡️ Slack Bolt app is running on port ${port}!`);

    const repos = await OCTOBOT.request("GET /orgs/{org}/repos", {
        org: "hacksnowbound",
    }).then((response) => {
        return response["data"].map((repo) => {
            return repo["name"];
        });
    });

    let userID;
    const isRepoName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const isGithubUsername = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

    slackapp.command("/repo-create", async ({ ack, body, client, logger, say }) => {
        await ack();

        if (body["channel_id"] !== repoCreationChannel) {
            await slackapp.client.chat.postEphemeral({
                token: process.env.SLACK_BOT_TOKEN,
                channel: body["channel_id"],
                user: body["user_id"],
                text: `Sorry, you can only use this command in the <#${repoCreationChannel}> channel.`,
            });
            return;
        }

        try {
            const result = await client.views.open({
                trigger_id: body.trigger_id,
                view: {
                    type: "modal",
                    callback_id: "create_repo_modal",
                    title: {
                        type: "plain_text",
                        text: "Create a new Github Repo",
                    },
                    blocks: [
                        {
                            type: "input",
                            block_id: "repo_name",
                            element: {
                                type: "plain_text_input",
                                action_id: "repo_name",
                                placeholder: {
                                    type: "plain_text",
                                    text: "Enter the name of your repo (no spaces, but dashes are ok!)",
                                },
                            },
                            label: {
                                type: "plain_text",
                                text: "Repo Name",
                            },
                        },
                        {
                            type: "input",
                            block_id: "repo_description",
                            element: {
                                type: "plain_text_input",
                                action_id: "repo_description",
                                placeholder: {
                                    type: "plain_text",
                                    text: "Enter a description for your repo. Please be short and descriptive!",
                                },
                            },
                            label: {
                                type: "plain_text",
                                text: "Repo Description",
                            },
                        },
                        {
                            type: "input",
                            block_id: "repo_owner",
                            element: {
                                type: "plain_text_input",
                                action_id: "repo_owner",
                                placeholder: {
                                    type: "plain_text",
                                    text: "Enter your Github username.",
                                },
                            },
                            label: {
                                type: "plain_text",
                                text: "Repo Owner",
                            },
                        },
                    ],
                    submit: {
                        type: "plain_text",
                        text: "Submit",
                    },
                },
            });
            userID = body["user_id"];
        } catch (error) {
            logger.error(error);
        }
    });

    slackapp.view("create_repo_modal", async ({ ack, view }) => {
        const repoName = view["state"]["values"]["repo_name"]["repo_name"]["value"];
        const repoDescription =
            view["state"]["values"]["repo_description"]["repo_description"]["value"];
        const repoOwner =
            view["state"]["values"]["repo_owner"]["repo_owner"]["value"];

        if (!repoName || !isRepoName.test(repoName)) {
            await ack({
                response_action: "errors",
                errors: {
                    repo_name:
                        "Sorry, that repo name isn't valid! Please make sure you have no dashes and try again.",
                },
            });
            return;
        } else if (repos.includes(`${repoName}`)) {
            await ack({
                response_action: "errors",
                errors: {
                    repo_name:
                        "Sorry, that repo name already exists! Are you sure you haven't already created it?",
                },
            });
            return;
        } else if (!repoDescription) {
            await ack({
                response_action: "errors",
                errors: {
                    repo_description:
                        "Sorry, that repo description isn’t valid. Please try again.",
                },
            });
            return;
        } else if (!repoOwner || !isGithubUsername.test(repoOwner)) {
            await ack({
                response_action: "errors",
                errors: {
                    repo_owner: "Sorry, that repo owner isn’t valid. Please try again.",
                },
            });
            return;
        } else {
            await ack({
                response_action: "clear",
            });

            slackapp.client.chat.postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: repoApprovalsChannel,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `A new repo has been requested by <@${userID}>! :tada:`,
                        },
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `*Repo Name:* ${repoName}\n*Repo Description:* ${repoDescription}\n*Repo Owner:* https://github.com/${repoOwner}`,
                        },
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    text: "Approve",
                                },
                                style: "primary",
                                value: "approve",
                                action_id: "approve_repo",
                            },
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    text: "Deny",
                                },
                                style: "danger",
                                value: "deny",
                                action_id: "deny_repo",
                            },
                        ],
                    },
                ],
            });

            slackapp.client.chat.postEphemeral({
                token: process.env.SLACK_BOT_TOKEN,
                channel: repoCreationChannel,
                user: userID,
                text: `Your repo ${repoName} has been requested. Please wait for an admin to approve it.`,
            });
        }
    });

    slackapp.action("approve_repo", async ({ ack, body, client, logger }) => {
        await ack();

        let repoName = body["message"]["blocks"][1]["text"]["text"].split("*")[2];

        // remove any leading or trailing spaces on the repo name
        repoName = repoName.trim();

        const repoDescription =
            body["message"]["blocks"][1]["text"]["text"].split("*")[4];
        const repoOwner = body["message"]["blocks"][1]["text"]["text"]
            .split("*")[6]
            .split("/")[3]
            .replace(">", "");
        const slackId = body["message"]["blocks"][0]["text"]["text"]
            .split("<@")[1]
            .split(">")[0];

        await createGithubrepo(repoName, repoDescription, repoOwner, slackId, body);
    });

    slackapp.action("deny_repo", async ({ ack, body, client, logger }) => {
        await ack();

        let repoName = body["message"]["blocks"][1]["text"]["text"].split("*")[2];

        // remove any leading or trailing spaces on the repo name
        repoName = repoName.trim();

        const repoDescription =
            body["message"]["blocks"][1]["text"]["text"].split("*")[4];

        let repoOwner = body["message"]["blocks"][1]["text"]["text"]
            .split("*")[6]
            .split("/")[3]
            .replace(">", "");

        const slackId = body["message"]["blocks"][0]["text"]["text"]
            .split("<@")[1]
            .split(">")[0];

        const conv = await slackapp.client.conversations.open({
            token: process.env.SLACK_BOT_TOKEN,
            users: slackId,
        });

        const channel = conv["channel"]["id"];

        await slackapp.client.chat.postMessage({
            token: process.env.SLACK_BOT_TOKEN,
            channel: channel,
            text: `Your repo ${repoName} has been denied. Please contact an admin for more information.`,
        });

        await slackapp.client.chat.update({
            token: process.env.SLACK_BOT_TOKEN,
            channel: repoApprovalsChannel,
            ts: body["message"]["ts"],
            text: "Repo Creation Request (Denied)",
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `A new repo has been requested by <@${slackId}>! :tada:`,
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Repo Name:* ${repoName}\n*Repo Description:* ${repoDescription}\n*Repo Owner:* ${repoOwner}`,
                    },
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `This repo has been *denied* by <@${body["user"]["id"]}>.`,
                        },
                    ],
                },
            ],
        });
    });

    createGithubrepo = async (
        repoName,
        repoDescription,
        repoOwner,
        slackId,
        body
    ) => {
        repoDescription = repoDescription.trim().replace(/\n/g, "\\n");

        const response = await OCTOBOT.request("POST /repos/{template_owner}/{template_repo}/generate", {
            template_owner: 'hacksnowbound',
            template_repo: 'project-template',
            owner: 'hacksnowbound',
            name: repoName,
            description: repoDescription,
            private: false,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        const repoUrl = response["data"]["html_url"];

        // colaborator will sometimes have something like a %e in it, which is a url encoded space, or an @ at the beginning
        // this will remove those
        await OCTOBOT.request(
            "PUT /repos/{owner}/{repo}/collaborators/{username}",
            {
                owner: 'hacksnowbound',
                repo: repoName,
                username: repoOwner,
                permission: "write",
            }
        );

        // update the repo
        await OCTOBOT.request(
            "PATCH /repos/{owner}/{repo}",
            {
                owner: 'hacksnowbound',
                repo: repoName,
                has_issues: true,
                has_projects: true,
                has_wiki: true,
                has_downloads: true,
                team_id: 8886814,
                auto_init: true,
                allow_squash_merge: false,
                allow_merge_commit: true,
                allow_rebase_merge: false,
                allow_auto_merge: true,
                delete_branch_on_merge: true,
            }
        );

        const conv = await slackapp.client.conversations.open({
            token: process.env.SLACK_BOT_TOKEN,
            users: slackId,
        });

        const channel = conv["channel"]["id"];

        await slackapp.client.chat
            .postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: channel,
                text: `Your repo is ready! :tada: You can find it at ${repoUrl}. Happy creating!`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `Your repo is ready! :tada: You can find it at ${repoUrl}. Happy creating!`,
                        },
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `*Repo Name:* ${repoName}\n*Repo Description:* ${repoDescription}\n*Repo Owner:* ${repoOwner}`,
                        },
                    },
                    {
                        type: "context",
                        elements: [
                            {
                                type: "mrkdwn",
                                text: "If you need to add more people to your repo, or have any other questions, please ask in the <#C0643HAAE87|repo-creation> channel.",
                            },
                        ],
                    },
                ],
            })
            .then(async () => {
                await slackapp.client.chat.update({
                    token: process.env.SLACK_BOT_TOKEN,
                    channel: repoApprovalsChannel,
                    ts: body["message"]["ts"],
                    text: "Repo Creation Request (Approved)",
                    blocks: [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `A new repo has been requested by <@${slackId}>! :tada:`,
                            },
                        },
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `*Repo Name:* ${repoName}\n*Repo Description:* ${repoDescription}\n*Repo Owner:*`,
                            },
                        },
                        {
                            type: "context",
                            elements: [
                                {
                                    type: "mrkdwn",
                                    text: `This repo has been _approved_ by <@${body["user"]["id"]}>.`,
                                },
                            ],
                        },
                    ],
                });
            });

        await slackapp.client.chat.postMessage({
            token: process.env.SLACK_BOT_TOKEN,
            channel: repoCreationChannel,
            text: `The repo${repoName}has been created by <@${slackId}>. Go check it out at ${repoUrl}! :rocket:`,
        });
    };

    cleanup = async (slackapp) => {
        const approvalsMessages = await slackapp.client.conversations.history({
            token: process.env.SLACK_BOT_TOKEN,
            channel: repoApprovalsChannel,
        });

        const creationMessages = await slackapp.client.conversations.history({
            token: process.env.SLACK_BOT_TOKEN,
            channel: repoCreationChannel,
        });

        approvalsMessages["messages"].forEach(async (message) => {
            await slackapp.client.chat.delete({
                token: process.env.SLACK_BOT_TOKEN,
                channel: repoApprovalsChannel,
                ts: message["ts"],
            });
        });

        creationMessages["messages"].forEach(async (message) => {
            await slackapp.client.chat.delete({
                token: process.env.SLACK_BOT_TOKEN,
                channel: repoCreationChannel,
                ts: message["ts"],
            });
        });

        console.log("CLEANUP COMPLETE");
    };
})();
