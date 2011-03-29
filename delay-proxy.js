/*jslint nomen:false */
var http = require('http');

// This proxy imposes a 30-second delay on certain sites.
//
// engage with:
// sudo iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080 -m owner '!' --uid-owner nobody
// sudo -u nobody node rotating-proxy.js

var al = new (require('./lib/async_lock.js').AsyncLock)(),
    BYTES_PER_SEC=10000,
    TIMED_DOMAINS = ['hackerne.ws', 'www.reddit.com', 'iamlights', 'bofh.ntk.net',
    'qdb.us', 'bash.org', 'meatandsarcasmguy', 'twitter.com'];

function shouldBeTimed(req) {
  if (req.url.indexOf("png") != -1 ||
      req.url.indexOf("css") != -1 ||
      req.url.indexOf("jpg") != -1 ||
      req.url.indexOf("ico") != -1 ||
      req.url.indexOf("gif") != -1) {
    return false;
  }
  for (var target=0,l=TIMED_DOMAINS.length; target<l; target++) {
    if (req.headers.host.toLowerCase().indexOf(TIMED_DOMAINS[target]) != -1) {
      return true;
    }
  }
  return false;
}

function Proxy(proxiedReq, proxiedRes, onIncomingData, onIncomingEnd) {
  // Make the outgoing connection
  console.log("Got request for "+proxiedReq.headers.host+" : "+proxiedReq.url+"...");
  delete proxiedReq.headers.connection;
  var newClient = http.createClient(80, proxiedReq.headers.host),
      newReq = newClient.request(proxiedReq.method, proxiedReq.url, proxiedReq.headers);
  proxiedReq.connection.setMaxListeners(15);
  proxiedReq.connection.addListener('error', function(error) {
    console.log(error);
    console.log(error.stack);
    onIncomingEnd();
  });
  proxiedReq.connection.addListener('end', function(error) {
    console.log("Canceling request");
    onIncomingEnd();
  });

  newClient.addListener('error', function(error) {
    console.log(error);
    console.log(error.stack);
    onIncomingEnd();
  });

  newReq.addListener('response', function(newRes) {
    // when the server (the website the client is browsing to) gives us our
    // response
    console.log("Got response");

    newRes.addListener('error', function(error) {
      console.log(error);
      console.log(error.stack);
      onIncomingEnd();
    });
    newRes.addListener('data', function(chunk) {
      //proxiedRes.write(chunk, 'binary');
      onIncomingData(chunk);
    });
    newRes.addListener('end', function() {
      onIncomingEnd();
    });
    // pass headers on to the client
    proxiedRes.writeHead(newRes.statusCode, newRes.headers);
  });

  proxiedReq.addListener('data', function(chunk) {
    // when the client sends data, pass it through
    newReq.write(chunk, 'binary');
  });

  newReq.end();
}

http.createServer(function(proxiedReq, proxiedRes) {
  var proxy;
  if (shouldBeTimed(proxiedReq)) {
    var ended = false, queue=[];
    proxy = new Proxy(proxiedReq, proxiedRes,
      function onData(chunk) {
        queue.push(chunk);
      }, function onEnd() {
        ended = true;
      });
    var idx = false;
    setTimeout(function next(){
        // if we have things in the queue, send them
        var bytes_we_want = 1;
        while (bytes_we_want > 0 && queue.length) {
          // send buffer
          if (idx + bytes_we_want > queue[0].length) {
            proxiedRes.write(queue[0].slice(idx), 'binary');
            bytes_we_want -= queue[0].length;
            idx = 0;
            queue.shift();
          } else {
            proxiedRes.write(queue[0].slice(idx, idx + bytes_we_want), 'binary');
            idx += bytes_we_want;
            bytes_we_want = 0;
          }
        }
        if (queue.length!==0 || !ended) {
          setTimeout(next, 1000/BYTES_PER_SEC);
        }
      }, 1000/BYTES_PER_SEC);
  } else {
    proxy = new Proxy(proxiedReq, proxiedRes,
      function onData(chunk) {
        proxiedRes.write(chunk, 'binary');
      }, function onEnd() {
        proxiedRes.end();
      });
  }
}).listen(8080);
