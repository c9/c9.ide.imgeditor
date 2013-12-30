define(function(require, exports, module) {
    main.consumes = [
        "Editor", "editors", "ui", "save", "vfs", "layout"
    ];
    main.provides = ["imgeditor"];
    return main;

    function main(options, imports, register) {
        var ui       = imports.ui;
        var vfs      = imports.vfs;
        var save     = imports.save;
        var layout   = imports.layout;
        var Editor   = imports.Editor;
        var editors  = imports.editors;
        
        var event    = require("ace/lib/event");
        var Pixastic = require("./lib_pixastic");
        
        var counter     = 0;
        var loadedFiles = {};
        
        /***** Initialization *****/
        
        var extensions = ["bmp", "djv", "djvu", "jpg", "jpeg", 
                          "pbm", "pgm", "png", "pnm", "ppm", "psd", "tiff", 
                          "xbm", "xpm"];
        
        var handle = editors.register("imgeditor", "Image Editor", ImageEditor, extensions);
        
        var drawn;
        handle.draw = function(){
            if (drawn) return;
            drawn = true;
            
            // Insert CSS
            ui.insertCss(require("text!./style.css"), 
                options.staticPrefix, handle);
        };
        
        // @todo revert to saved doesnt work (same for file watcher reload)
        // @todo getState/setState
        // @todo keep canvas reference on session and remove loadedFiles
        // @Todo for later - add undo stack
        function UndoItem(original, changed, apply){
            this.getState = function(){ }
            this.undo = function(){ 
                apply(original);
            }
            this.redo = function(){ 
                apply(changed);
            }
        }
        // undoManager.on("itemFind", function(e){
        //     return new Item(e.state[0], e.state[1]);
        // });
        
        function ImageEditor(){
            var plugin = new Editor("Ajax.org", main.consumes, extensions);
            
            var BGCOLOR = "#3D3D3D";
            var img, canvas, activeDocument, rect, crop, zoom, info, rectinfo;
            
            plugin.on("draw", function(e){
                handle.draw();
                
                ui.insertMarkup(e.tab, require("text!./imgeditor.xml"), plugin);
                
                var editor = plugin.getElement("imgEditor");
                var parent = plugin.getElement("parent");
                var btn3   = plugin.getElement("btn3");
                var btn4   = plugin.getElement("btn4");
                var btn5   = plugin.getElement("btn5");
                var btn6   = plugin.getElement("btn6");
                
                crop     = plugin.getElement("btn2");
                zoom     = plugin.getElement("zoom");
                info     = plugin.getElement("info");
                rectinfo = plugin.getElement("rectinfo");
                
                // Background color
                parent.$ext.style.backgroundColor = BGCOLOR;
                
                // Rectangle
                rect = document.createElement("div");
                editor.$ext.appendChild(rect);
                rect.className = "imgeditorrect";
                
                img    = editor.$ext.querySelector("img");
                canvas = function(){
                    return editor.$ext.querySelector("canvas");
                }
                
                // Zoom
                zoom.on("afterchange", function(){
                    ui.setStyleRule(".imgeditor canvas", 
                        apf.CSSPREFIX2 + "-transform", 
                        "scale(" + (zoom.value / 100) + ")");
                    
                    var session = activeDocument.getSession();
                    session.zoom = zoom.value;
                    
                    clearRect();
                });
                
                // resize width/height
                crop.on("click", function(){ exec("crop") });
                btn3.on("click", function(){ exec("rotate", { angle: -90 }); });
                btn4.on("click", function(){ exec("rotate", { angle: 90 }); });
                btn5.on("click", function(){ exec("fliph"); });
                btn6.on("click", function(){ exec("flipv"); });
                
                editor.$ext.onmousemove = function(e){
                    if (rect.style.display != "none")
                        return;
                    
                    var cnvs  = canvas();
                    var pos   = cnvs.getBoundingClientRect();
                    var left  = e.clientX - pos.left;
                    var top   = e.clientY - pos.top;
                    
                    var zoomLevel = zoom.value / 100;
                    if (left < 0 || top < 0 
                      || left > pos.width || top > pos.height)
                        left = top = 0;
                        
                    rectinfo.setAttribute("caption", 
                        "L: " + (left / zoomLevel) + "px, "
                        + "T: " + (top / zoomLevel) + "px");
                }
                
                editor.$ext.onmousedown = function(e){
                    var cnvs  = canvas();
                    var pos   = cnvs.getBoundingClientRect();
                    var left  = e.clientX - pos.left;
                    var top   = e.clientY - pos.top;
                    if (left < 0 || top < 0 
                      || left > pos.width || top > pos.height)
                        return;
                    
                    startRect(e);
                };
                
                function saveCanvas(path, value, callback){
                    var dataURL = loadedFiles[path];
                    var binary  = atob(dataURL.split(',')[1]);
                    
                    vfs.rest(path, {
                        method : "PUT", 
                        body   : binary
                    }, function(err, data, res) {
                        callback(err, data);
                    });
                }
                
                save.on("beforeSave", function(e) {
                    if (e.document.editor.type == "imgeditor"){
                        var path = e.document.tab.path;
                        
                        if (e.document == activeDocument)
                            loadedFiles[path] = canvas().toDataURL();
                            
                        return saveCanvas;
                    }
                });
                
                // Not sure what this is supposed to do
                // save.on("afterSave", function(e) {
                //     console.log("afterfilesave");
                //     var path = e.document.tab.path;
                //     if (!path)
                //         return;
                    
                //     var newPath = e.doc && e.doc.getNode && e.doc.getNode().getAttribute("path");
                //     if (editor.value == e.oldpath && newPath !== e.oldpath){
                //         var dataURL = _canvas.toDataURL();
                //         saveCanvas(newPath,dataURL);
                //         return false;
                //     }
                // });
        
                if (!editor.focus)
                    editor.focus = function(){ return false;};
                
                editor.show();
            });
            
            /***** Method *****/
            
            function setPath(path, doc){
                if (!path) return;
                
                // Caption is the filename
                doc.title = path.substr(path.lastIndexOf("/") + 1);
                
                // Tooltip is the full path
                doc.tooltip = path;
                
                var fullpath = path.match(/^\w+:\/\//)
                    ? path
                    : vfs.url(path);
                    
                // editor.setProperty("value", apf.escapeXML(fullpath));
                loadCanvas(doc.tab, fullpath);
            }
            
            function loadCanvas(tab, path){
                var idx  = tab.path;
                var cnvs = canvas();
                var ctx  = cnvs.getContext("2d");
                
                if (path && !loadedFiles[idx]){
                    tab.className.add("connecting");
                    
                    img.onload = function(){
                        cnvs.width         = img.width;
                        cnvs.height        = img.height;
                        img.style.display  = "none";
                        
                        ctx.drawImage(img, 0, 0);
                        loadedFiles[idx] = cnvs.toDataURL();
                        
                        info.setAttribute("caption", 
                            "W:" + img.width + "px, H:" + img.height + "px");
                        
                        tab.className.remove("connecting");
                    };
                    img.onerror = function(){
                        tab.className.remove("connecting");
                        tab.className.add("error");
                        
                        img.src = options.staticPrefix + "/sorry.jpg";
                        
                        layout.showError("Invalid or Unsupported Image Format");
                    }
                    
                    img.src = path;
                }
                else {
                    img.onload = function(){
                        cnvs.width         = img.width;
                        cnvs.height        = img.height;
                        img.style.display  = "none";
                        
                        info.setAttribute("caption", 
                            "W:" + img.width + "px, H:" + img.height + "px");
                        
                        ctx.drawImage(img, 0, 0);
                    };
                    
                    img.src = loadedFiles[idx];
                }
            }
            
            function startRect(e, grabber, editor){
                var container = rect.parentNode;
                var pos       = container.getBoundingClientRect();
                var cnvs      = canvas();
                
                var startX  = e.clientX;
                var startY  = e.clientY;
                var moved;
                
                event.capture(container, function(e) {
                    if (!moved) {
                        if (Math.abs(startX - e.clientX) + Math.abs(startY - e.clientY) > 5) {
                            moved = true;
                            rect.style.display = "block";
                        }
                        else return;
                    }
                    
                    if (startX > e.clientX) {
                        rect.style.left = (e.clientX - pos.left) + "px";
                        rect.style.width  = (startX - e.clientX) + "px";
                    }
                    else {
                        rect.style.left = (startX - pos.left) + "px";
                        rect.style.width  = (e.clientX - startX) + "px";
                    }
                    
                    if (startY > e.clientY) {
                        rect.style.top  = (e.clientY - pos.top) + "px";
                        rect.style.height = (startY - e.clientY) + "px";
                    }
                    else {
                        rect.style.top  = (startY - pos.top) + "px";
                        rect.style.height = (e.clientY - startY) + "px";
                    }
                    
                    var zoomLevel = zoom.value / 100;
                    rectinfo.setAttribute("caption", 
                        "L: " + ((rect.offsetLeft - cnvs.offsetLeft) / zoomLevel) + "px, "
                        + "T: " + ((rect.offsetTop - cnvs.offsetTop) / zoomLevel) + "px, "
                        + "W: " + (rect.offsetWidth / zoomLevel) + "px, "
                        + "H: " + (rect.offsetHeight / zoomLevel) + "px");
                    
                }, function() {
                    if (moved) {
                        activeDocument.getSession().rect = {
                            left   : rect.style.left,
                            top    : rect.style.top,
                            width  : rect.style.width,
                            height : rect.style.height,
                        }
                        crop.enable();
                    }
                    else {
                        clearRect();
                    }
                });
                
                event.stopEvent(e);
            }
            
            function exec(action, options){
                var cnvs = canvas();
                var url  = cnvs.toDataURL();
                
                if (action == "crop") {
                    var zoomLevel = zoom.value / 100;
                    
                    options = {
                        left   : (rect.offsetLeft - cnvs.offsetLeft) / zoomLevel,
                        top    : (rect.offsetTop - cnvs.offsetTop) / zoomLevel,
                        width  : (rect.offsetWidth) / zoomLevel,
                        height : (rect.offsetHeight) / zoomLevel
                    }
                }
                
                Pixastic.process(cnvs, action, options);
                clearRect();
                
                //@todo
                var doc = activeDocument;
                doc.undoManager.add(new UndoItem(url, canvas().toDataURL(), function(url){
                    loadedFiles[doc.tab.path] = url;
                    loadCanvas(doc.tab);
                }));
            }
            
            function clearRect(){
                rect.style.display = "none";
                delete activeDocument.getSession().rect;
                crop.disable();
            }
            
            plugin.on("documentLoad", function(e){
                var doc     = e.doc;
                var session = doc.getSession();
                
                doc.tab.on("setPath", function(e){
                    setPath(e.path, doc);
                }, session);
                
                // Changed marker
                function setChanged(e){
                    if (e.changed || doc.meta.newfile)
                        doc.tab.className.add("changed");
                    else
                        doc.tab.className.remove("changed");
                }
                doc.on("changed", setChanged, session);
                setChanged({ changed: doc.changed });
                
                doc.tab.backgroundColor = BGCOLOR;
                doc.tab.className.add("dark");
            });
            
            plugin.on("documentActivate", function(e){
                var doc     = e.doc;
                var session = doc.getSession();
                var path    = doc.tab.path || doc.value;
                
                activeDocument = doc;
                
                // Set Image
                setPath(path, doc);
                
                // Set Toolbar
                zoom.setValue(session.zoom || 100);
                zoom.dispatchEvent("afterchange");
                
                // Set Rect
                if (session.rect) {
                    rect.style.display = "block";
                    rect.style.left   = session.rect.left;
                    rect.style.top    = session.rect.top;
                    rect.style.width  = session.rect.width;
                    rect.style.height = session.rect.height;
                }
                else {
                    rect.style.display = "none";
                }
            });
            
            plugin.on("documentUnload", function(e){
                delete loadedFiles[e.doc.tab.path || e.doc.value];
            });
            
            /***** Register and define API *****/
            
            /**
             * The imgeditor handle, responsible for events that involve all 
             * ImageEditor instances. This is the object you get when you request 
             * the imgeditor service in your plugin.
             * 
             * Example:
             * 
             *     define(function(require, exports, module) {
             *         main.consumes = ["imgeditor"];
             *         main.provides = ["myplugin"];
             *         return main;
             *     
             *         function main(options, imports, register) {
             *             var imgeditorHandle = imports.imgeditor;
             *         });
             *     });
             * 
             * 
             * @class imgeditor
             * @extends Plugin
             * @singleton
             */
            /**
             * Read Only Image Viewer for Cloud9 IDE
             * 
             * Example of instantiating a new terminal:
             * 
             *     tabManager.openFile("/test.png", true, function(err, tab){
             *         if (err) throw err;
             * 
             *         var imgeditor = tab.editor;
             *     });
             * 
             * @class imgeditor.ImageEditor
             * @extends Editor
             **/
            /**
             * The type of editor. Use this to create the terminal using
             * {@link tabManager#openEditor} or {@link editors#createEditor}.
             * @property {"imgeditor"} type
             * @readonly
             */
            plugin.freezePublicAPI({});
            
            plugin.load("imgeditor" + counter++);
            
            return plugin;
        }
        ImageEditor.autoload = false;
        
        register(null, {
            imgeditor: handle
        });
    }
});