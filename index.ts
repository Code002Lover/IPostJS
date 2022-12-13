import * as https from "https"
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

const base_url = "ipost.rocks"


function sleep(ms:number){
    return new Promise(resolve=>setTimeout(resolve,ms))
}

class Channel {

}

class User {

    username:string
    avatar_uri:string
    dm_channel?:Channel

    constructor(username:string,avatar?:string) {
        this.username = username
        this.avatar_uri = avatar??"/images/default_avatar.png"
    }

    public toString() : string {
        return this.username
    }
}

type HTTPOut = {[index:string]:any}

class Post {
    private API? : IPost
    readonly post_sender: User
    readonly post_text: string
    readonly post_time:number
    readonly post_id:number
    readonly post_from_bot:boolean
    private readonly post_reply_id:number
    readonly files:{[index:number]:string}
    readonly post_special_text:string
    readonly channel:string

    public toString() : string {
        return `${this.post_sender} : ${this.post_text} @ ${new Date(this.post_time)}`
    }

    constructor(post_user_name:string,post_text:string,post_time:number,post_id:number,post_from_bot:boolean,post_reply_id:number,user_avatar:string,file0?:string,file1?:string,file2?:string,file3?:string,file4?:string,post_special_text?:string,post_channel?:string,API?:IPost) {
        this.post_text = post_text
        this.post_time = post_time
        this.post_id = post_id
        this.post_from_bot = post_from_bot
        this.post_reply_id = post_reply_id
        this.files = {
            0:file0??"",
            1:file1??"",
            2:file2??"",
            3:file3??"",
            4:file4??""
        }
        this.post_special_text = post_special_text??""
        this.post_sender = new User(post_user_name,user_avatar)
        this.API = API
        this.channel = post_channel??"everyone"
    }

    reply(post_text:string) : Promise<boolean> {

        return new Promise(async resolve => {
            if(this.API === undefined) {
                throw new Error("API has to be set before calling API functions!")
            }
            let post_channel = (await this.get_replied_post()).channel
            this.API.postMessage(post_text,post_channel,this.post_id).then(resolve)
        })
    }

    set_api(API:IPost) {
        this.API = API
    }

    get_replied_post() : Promise<Post> {
        if(this.API === undefined) {
            throw new Error("API has to be set before calling API functions!")
        }
        return this.API.getPostById(this.post_reply_id)
    }
}

class IPost extends EventEmitter {

    public toString() : string {
        return "IPost API Class"
    }

    private api_call(path:string,method:string,callback:Function,data?:{[index: string]:any}) {
        if(method.toUpperCase() === "GET" && data !== undefined) {
            path += "?"
            let isFirst:boolean = true
            for(let key in data) {
                if(!isFirst){
                    path += "&"
                }
                path += key + "=" + data[key]
            }
            data = {}
        }
        const request_options = {
            host: base_url,
            path: path,
            port: 443,
            method: method.toUpperCase(),
            headers: {
                "Content-Type": "application/json",
                "accept":"application/json, text/plain",
                Cookie: ""
            },
            agent: this.httpsAgent
        }
        if(this.Cookie !== "") {
            request_options.headers.Cookie = "AUTH_COOKIE"+this.Cookie
        }
        function handle_request(response:any) {
            let data:string = ""
            response.on("data",function(chunk:string) {
                data+=chunk
            })
            response.on("end",function(){
                callback({
                    data: data,
                    statusCode: response.statusCode,
                    headers: response.headers,
                })
            })
        }

        let req:any = https.request(request_options,handle_request)
        if(JSON.stringify(data)!=="{}" && JSON.stringify(data)!==undefined)req.write(JSON.stringify(data))
        req.end()
    }

    private websocket_connection:WebSocket = new WebSocket('wss://'+base_url);

    private Cookie : string = ""
    private readonly httpsAgent = new https.Agent({
        keepAlive: true,
        maxSockets: 128
    })

    initialized:boolean = true

    private loginCallback(out:{[index: string]:any}){
        if(out.headers.location !== "/user") {
            throw new Error("invalid credentials passed on")
        }
        this.Cookie = out.headers["set-cookie"][0].split(" ")[0].split("AUTH_COOKIE")[1]
        this.initialized = true
    }

    constructor(auth_cookie: string, password?: string) {
        super()
        if(password !== undefined) {
            if(!auth_cookie.endsWith("@unsafe"))auth_cookie+="@unsafe"
            this.initialized = false
            this.api_call("/login","POST",this.loginCallback.bind(this),{
                user: auth_cookie,
                pass: password
            })
        } else
       this.Cookie = "AUTH_COOKIE="+auth_cookie

        this.websocket_connection.on('open', function open() {
            this.websocket_connection.send(JSON.stringify({"id":"switchChannel","data":"everyone"})) //Switch to default channel
        }.bind(this));

        this.websocket_connection.on('message', function incoming(data) {
            let packet = JSON.parse(data.toString())
            let post = packet.data
            // console.log(packet)
            this.emit("message",new Post(decodeURIComponent(post.post_user_name),decodeURIComponent(post.post_text),post.post_time,post.post_id,post.post_from_bot,post.post_reply_id,post.user_avatar,post.file_0,post.file_1,post.file_2,post.file_3,post.file_4,post.post_special_text,post.post_receiver_name,this))
        }.bind(this));
    }

    getPosts(channel? : string) : Promise<{[index:number]:Post}> {
        if(channel === undefined)channel="everyone"
        return new Promise(async function(resolve:Function) {
            while(!this.initialized)await sleep(100)
            this.api_call("/api/getPosts","GET",function(out:HTTPOut){
                let posts_raw = JSON.parse(out.data)
                let posts:Post[] = []
                for(let post of posts_raw) {
                    posts.push(new Post(decodeURIComponent(post.post_user_name),decodeURIComponent(post.post_text),post.post_time,post.post_id,post.post_from_bot,post.post_reply_id,post.user_avatar,post.file_0,post.file_1,post.file_2,post.file_3,post.file_4,post.post_special_text,post.post_receiver_name,this))
                }
                resolve(posts)
            }.bind(this),{
                channel: channel
            })
        }.bind(this))
    }

    getPostById(postid: number) : Promise<Post>{
        return new Promise(async function(resolve:Function) {
            while(!this.initialized)await sleep(100)
            this.api_call("/api/getPost","GET",function(out:HTTPOut){
                let post:any = JSON.parse(out.data)
                resolve(new Post(decodeURIComponent(post.post_user_name),decodeURIComponent(post.post_text),post.post_time,post.post_id,post.post_from_bot,post.post_reply_id,post.user_avatar,post.file_0,post.file_1,post.file_2,post.file_3,post.file_4,post.post_special_text,post.post_receiver_name,this))
            }.bind(this),{
                id: postid
            })
        }.bind(this))
    }

    postMessage(post_text:string,channel:string,post_reply_id?:number) : Promise<boolean> {
        if(post_reply_id===undefined)post_reply_id=0
        return new Promise(async function(resolve:Function) {
            this.api_call("/api/pid","GET",function(out:HTTPOut){
                let PID = JSON.parse(out.data).pid
                this.api_call("/api/post","POST",function(out:HTTPOut){
                    resolve(true)
                },{
                    message: post_text,
                    reply_id: post_reply_id,
                    receiver: channel,
                    pid: PID
                })
            }.bind(this))
        }.bind(this))
    }
}

export {
    IPost,
    Post,
    Channel
}