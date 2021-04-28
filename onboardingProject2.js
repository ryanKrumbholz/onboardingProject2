require('dotenv').config();
const {google} = require('googleapis');
const {backOff} = require('exponential-backoff');
const http = require('http');
const url = require('url');
const opn = require('open');
const destroyer = require('server-destroy');

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URL
);

const scopes = [
    'https://www.googleapis.com/auth/tagmanager.edit.containers',
    'https://www.googleapis.com/auth/tagmanager.readonly'
  ];

const authorizeUrl = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: 'offline',
  
    // If you only need one scope you can pass it as a string
    scope: scopes
});

const tagmanager = google.tagmanager('v2');
const containers = tagmanager.accounts.containers;
google.options({auth: oauth2Client});

function auth() {
    return new Promise((resolve, reject) => {
        const server = http
        .createServer(async (req, res) => {
            try {
            if (req.url.indexOf('/oauth2callback') > -1) {
                const qs = new url.URL(req.url, 'http://localhost:3000')
                .searchParams;
                res.end('Authentication successful! Please return to the console.');
                server.destroy();
                const {tokens} = await oauth2Client.getToken(qs.get('code'));
                oauth2Client.credentials = tokens; // eslint-disable-line require-atomic-updates
                resolve(oauth2Client);
            }
            } catch (e) {
            reject(e);
            }
        })
        .listen(3000, () => {
            // open the browser to the authorize url to start the workflow
            opn(authorizeUrl, {wait: false}).then(cp => cp.unref());
        });
        destroyer(server);
    });
}

async function cloneContainer(newContainerName, accountId, targetContainerPublicId){
    const targetContainer  = await getContainerByPublicId(targetContainerPublicId, accountId);
    const newContainer = await findOrCreateContainer(newContainerName, accountId);
    cloneContainerEntities(targetContainer, newContainer);
}

async function listContainers(accountId){
    const params = {
        parent: `accounts/${accountId}`
    }
     return (await backOff(() => containers.list(params), {numOfAttempts: 20})).data.container;
}

async function getContainerByPublicId(pid, accountId){
    // Get list of containers.
    const containersList = await listContainers(accountId);

    // Linearly searches for container with matching publicId, returns when found. Else throws error.
    for (let i = 0; i < containersList.length; i++) {
        if (containersList[i].publicId === pid){
            return containersList[i]
        }
    }
    throw new Error('Container with given public ID does not exist.');
}

async function findOrCreateContainer(newContainerName, targetAccountId){
    const containersList = await listContainers(targetAccountId);
    // Linearly searches for container with matching name. If it exist returns container. Else creates new container.
    for (let i = 0; i < containersList.length; i++) {
        if (containersList[i].name === newContainerName){
            return await containersList[i];
        }
    }
    return await createContainer(targetAccountId, newContainerName);
}

async function createContainer(accountId, newContainerName){
    const body = {
        name: newContainerName,
        usageContext: ['web']
    }
    const params = {    
        parent: `accounts/${accountId}`,
        requestBody: body
    }
    return await backOff(() => containers.create(params, body), {numOfAttempts: 20}); // Call to API to create container.
}

async function getContainerTags(accountId, containerId, workspaceId){
    
    const params = {    
        parent: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`
    }
    return (await backOff(() => containers.workspaces.tags.list(params), {numOfAttempts: 20})).data.tag;
}

async function getContainerTriggers(accountId, containerId, workspaceId){
    const params = {    
        parent: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`
    }
    return (await backOff(() => containers.workspaces.triggers.list(params), {numOfAttempts: 20})).data.trigger;
}

async function getContainerVariables(accountId, containerId, workspaceId){
    const params = {    
        parent: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`
    }
    return (await backOff(() => containers.workspaces.variables.list(params), {numOfAttempts: 20})).data.variable;
}

async function cloneContainerTag(accountId, containerId, tag, workspaceId, map){
    delete tag.path;
    delete tag.accountId;
    delete tag.containerId;
    delete tag.workspaceId;
    delete tag.fingerprint;
    delete tag.tagManagerUrl;
    
    let firingTriggerIds = [];
    tag.firingTriggerId.forEach(id => {
        if(map.has(id)) {
            firingTriggerIds.push(map.get(id));
        }
        else {
            firingTriggerIds.push(id)
        }
    });
    tag.firingTriggerId = firingTriggerIds;

    const params = {    
        parent: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`,
        requestBody: tag
    }
        try {
            const response = await backOff(() => containers.workspaces.tags.create(params), {numOfAttempts: 20});
            console.log('Tag created: ', response.data.name)
            return response;
        }
        catch (err){
            console.log(err);
        }
    
}

async function cloneContainerTrigger(accountId, containerId, trigger, workspaceId){
    delete trigger.path;
    delete trigger.accountId;
    delete trigger.containerId;
    delete trigger.workspaceId;
    delete trigger.fingerprint;
    delete trigger.tagManagerUrl;
    const params = {    
        parent: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`,
        requestBody: trigger
    }
        try {
            const response = await backOff(() => containers.workspaces.triggers.create(params), {numOfAttempts: 20});
            console.log('Trigger created: ', response.data.name)
            return response;
        }
        catch (err){
            console.log(err);
        }

}

async function cloneContainerVariable(accountId, containerId, variable, workspaceId){
    delete variable.path;
    delete variable.accountId;
    delete variable.containerId;
    delete variable.workspaceId;
    delete variable.fingerprint;
    delete variable.tagManagerUrl;
    const params = {    
        parent: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`,
        requestBody: variable
    }

        try {
            const response = await backOff(() => containers.workspaces.variables.create(params), {numOfAttempts: 20});
            console.log('Variable created: ', response.data.name)
            return response;
        }
        catch (err){
            console.log(err);
        }
}



async function cloneAllContainerTags(targetAccountId, targetContainerId, newAccountId, newContainerId, targetWorkspaceId, newWorkspaceId){
    const promise = new Promise(async (resolve, reject) => {
        const tags = await getContainerTags(targetAccountId, targetContainerId, targetWorkspaceId);
        let triggerIds = new Map();
        let targetTriggerNames = new Map();
        const existingTriggers = await getContainerTriggers(newAccountId, newContainerId, newWorkspaceId);
        const targetTriggers = await getContainerTriggers(targetAccountId, targetContainerId, targetWorkspaceId);
        if(targetTriggers) {
            targetTriggers.forEach(trigger => {
                targetTriggerNames.set(trigger.name, trigger.triggerId);
            });
        }
        if(existingTriggers) {
            existingTriggers.forEach(trigger => {
                if(targetTriggerNames.has(trigger.name)){
                    triggerIds.set(targetTriggerNames.get(trigger.name), trigger.triggerId);
                }
            });
        }
        for (const tag of tags){
            await cloneContainerTag(newAccountId, newContainerId, tag, newWorkspaceId, triggerIds);
        };
        console.log('Completed tag cloning.')
        resolve('resolved')
    })
    return promise;
}

async function cloneAllContainerTriggers(targetAccountId, targetContainerId, newAccountId, newContainerId, targetWorkspaceId, newWorkspaceId){
    const promise = new Promise(async (resolve, reject) => {
        let triggers = await getContainerTriggers(targetAccountId, targetContainerId, targetWorkspaceId);
        for (const trigger of triggers){
            await cloneContainerTrigger(newAccountId, newContainerId, trigger, newWorkspaceId);
        };
        console.log('Completed trigger cloning.')
        resolve('resolved')
    })
    return promise;
}

async function cloneAllContainerVairables(targetAccountId, targetContainerId, newAccountId, newContainerId, targetWorkspaceId, newWorkspaceId){
    const promise = new Promise(async (resolve, reject) => {
        const variables = await getContainerVariables(targetAccountId, targetContainerId, targetWorkspaceId);
        for (const variable of variables){
            await cloneContainerVariable(newAccountId, newContainerId, variable, newWorkspaceId);
        };
        console.log('Completed variable cloning.')
        resolve('resolved');
    })
    return promise;
}

async function cloneContainerEntities(targetContainer, newContainer){
    const awaitedTargetContainer = await targetContainer;
    const awaitedNewContainer = await newContainer;
    var targetAccountId = awaitedTargetContainer.accountId;
    var targetContainerId = awaitedTargetContainer.containerId;
    var newAccountId;
    var newContainerId;

    if(awaitedNewContainer.data){
        newAccountId = awaitedNewContainer.data.accountId;
        newContainerId = awaitedNewContainer.data.containerId;
    }
    else{
        newAccountId = awaitedNewContainer.accountId;
        newContainerId = awaitedNewContainer.containerId;
    }

    let targetWorkspaceId;
    let newWorkspaceId;

    try{
        targetWorkspaceId = await backOff(() => getWorkspaceId(targetAccountId, targetContainerId), {numOfAttempts: 20});
        newWorkspaceId = await backOff(() => getWorkspaceId(newAccountId, newContainerId), {numOfAttempts: 20});
        
    }  catch(error) {
        console.log(error)
    }
    
    await cloneAllContainerVairables(targetAccountId, targetContainerId, newAccountId, newContainerId, targetWorkspaceId, newWorkspaceId);
    await cloneAllContainerTriggers(targetAccountId, targetContainerId, newAccountId, newContainerId, targetWorkspaceId, newWorkspaceId);
    await cloneAllContainerTags(targetAccountId, targetContainerId, newAccountId, newContainerId, targetWorkspaceId, newWorkspaceId);
    console.log('Container cloning completed.');
    
}

async function getWorkspaceId(accountId, containerId){
    return (await getWorkspaces(accountId, containerId)).data.workspace[0].workspaceId;
}

async function getWorkspaces(accountId, containerId){
    const params = {
        parent: `accounts/${accountId}/containers/${containerId}`
    }
    const workspaces = (await backOff(() => containers.workspaces.list(params)));
    return workspaces;
}

async function main(){    
    auth()
        .then(async () => {
            const accountId = '4131139637';
            const containerPublicId = 'GTM-PR4BRDT';
            // Container exist
            cloneContainer('Onboarding Container - Ryan (Clone)', accountId, containerPublicId);
        })
}

main();
